import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { MIN_GO_DICOM_VERSION, isSupportedGoDicom, parseGoDicomVersion } from '../core/goDicom';

/** Why go-dicom could not produce output. The message is user-facing and holds no file data. */
export class GoDicomError extends Error {
  override readonly name = 'GoDicomError';
  constructor(
    readonly kind: 'notFound' | 'tooOld' | 'failed' | 'timeout' | 'cancelled' | 'tooLarge',
    message: string,
  ) {
    super(message);
  }
}

const INSTALL =
  'Install go-dicom 1.9.1 or later (https://github.com/amrshadid/go-dicom/releases) and put it on your PATH, or set "dicomTrace.goDicomPath".';
const MIN = MIN_GO_DICOM_VERSION.join('.');
/** go-dicom's JSON is about metadata size (bulk data stays in the file since 1.9.1). */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const PARSE_TIMEOUT_MS = 60_000;

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    // Windows has no execute bit; existence of the .exe is the check there.
    if (process.platform !== 'win32') await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves go-dicom to an absolute path: the configured path, else a PATH lookup.
 * Always absolute, so `execFile` never searches the working directory (on Windows that
 * would run a `go-dicom.exe` planted in the opened folder).
 */
export async function resolveGoDicom(configured: string): Promise<string> {
  if (configured) {
    if (!isAbsolute(configured)) {
      throw new GoDicomError(
        'notFound',
        `"dicomTrace.goDicomPath" must be an absolute path. ${INSTALL}`,
      );
    }
    if (await isExecutableFile(configured)) return configured;
    throw new GoDicomError('notFound', `go-dicom was not found at the configured path. ${INSTALL}`);
  }
  const names = process.platform === 'win32' ? ['go-dicom.exe'] : ['go-dicom'];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (await isExecutableFile(candidate)) return candidate;
    }
  }
  throw new GoDicomError('notFound', `go-dicom was not found on your PATH. ${INSTALL}`);
}

function run(
  executable: string,
  args: string[],
  signal: AbortSignal,
  timeout: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // No shell: arguments are passed as-is, so a file name can never become a command.
    execFile(
      executable,
      args,
      {
        encoding: 'utf8',
        maxBuffer: MAX_OUTPUT_BYTES,
        timeout,
        signal,
        windowsHide: true,
        shell: false,
      },
      (error, stdout) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        if (signal.aborted) reject(new GoDicomError('cancelled', 'Parsing was cancelled.'));
        else if ((error as NodeJS.ErrnoException).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          reject(
            new GoDicomError(
              'tooLarge',
              'go-dicom produced more output than the extension accepts.',
            ),
          );
        } else if ((error as { killed?: boolean }).killed) {
          reject(
            new GoDicomError('timeout', `go-dicom did not finish within ${timeout / 1000} s.`),
          );
        } else {
          reject(new GoDicomError('failed', 'go-dicom could not parse this file.'));
        }
      },
    );
  });
}

/** Checks the go-dicom version once per executable path. */
const checkedVersions = new Map<string, Promise<void>>();

async function ensureVersion(executable: string, signal: AbortSignal): Promise<void> {
  let check = checkedVersions.get(executable);
  if (!check) {
    // Shared by every editor that asks, so it must not die with the first caller's
    // signal; its own timeout bounds it. Each caller's cancel applies to that caller only.
    check = run(executable, ['version'], new AbortController().signal, 10_000).then((out) => {
      const version = parseGoDicomVersion(out);
      if (!version)
        throw new GoDicomError('tooOld', `Could not read the go-dicom version. ${INSTALL}`);
      if (!isSupportedGoDicom(version)) {
        throw new GoDicomError(
          'tooOld',
          `go-dicom ${version.join('.')} is too old; ${MIN} or later is needed. ${INSTALL}`,
        );
      }
    });
    checkedVersions.set(executable, check);
    check.catch(() => checkedVersions.delete(executable));
  }
  const shared = check;
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new GoDicomError('cancelled', 'Parsing was cancelled.'));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    shared.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

/**
 * Runs `go-dicom show <file> --json` and returns the parsed JSON (still untrusted).
 *
 * @param signal - Aborts the child process, e.g. when the editor closes.
 */
export async function showJson(
  configuredPath: string,
  filePath: string,
  signal: AbortSignal,
): Promise<unknown> {
  const executable = await resolveGoDicom(configuredPath);
  await ensureVersion(executable, signal);
  const out = await run(executable, ['show', filePath, '--json'], signal, PARSE_TIMEOUT_MS);
  try {
    return JSON.parse(out) as unknown;
  } catch {
    throw new GoDicomError('failed', 'go-dicom output was not valid JSON.');
  }
}
