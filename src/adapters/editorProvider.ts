import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import * as vscode from 'vscode';
import { normaliseGoDicom } from '../core/goDicom';
import type { InspectedElement } from '../core/inspection';
import { parseNiftiHeader } from '../core/nifti';
import { niftiView } from '../core/niftiModel';
import { objectInfo } from '../core/objectInfo';
import { webviewHtml } from '../core/webviewHtml';
import type { HostMessage, PaneLayout, Revisioned } from '../protocol/messages';
import { DEFAULT_LAYOUT, checkRead, parseWebviewMessage } from '../protocol/messages';
import { goDicomPath, onParserSettingChanged } from './configuration';
import { GoDicomError, showJson } from './goDicomRunner';
import { InspectorDocument } from './inspectorDocument';
import type { Log } from './log';

/** The custom editor's view type; must match `contributes.customEditors` in package.json. */
export const VIEW_TYPE = 'dicomTrace.inspector';

/** Largest file sent to the image pane (bounded work, story.md focus area 5). */
const MAX_IMAGE_BYTES = 512 * 1024 * 1024;
/** Largest inflated `.nii.gz` stream accepted. */
const MAX_INFLATED_BYTES = 1024 * 1024 * 1024;

const gunzipAsync = promisify(gunzip);

/** globalState key for the remembered pane layout. */
const LAYOUT_KEY = 'paneLayout';

/**
 * Test hooks: only when the integration test runner sets DT_TEST_HOOKS=1 (see
 * .vscode-test.mjs). They let tests ask a webview what it shows and drive it. In normal
 * use they are never registered and the webview never answers them.
 */
const TEST_HOOKS = process.env.DT_TEST_HOOKS === '1';
const testReplies = new Map<string, (state: unknown) => void>();

/** What a document currently shows: its revision and the messages that describe it. */
interface DocumentState {
  readonly revision: number;
  readonly messages: readonly HostMessage[];
}

const countElements = (els: readonly InspectedElement[]): number =>
  els.reduce((n, e) => n + 1 + e.items.reduce((m, i) => m + countElements(i.elements), 0), 0);

/**
 * Read-only custom editor for DICOM and NIfTI files. Registered with priority
 * "default": VS Code can't show these binary files as text, so clicking one opens it
 * here; "Reopen Editor With…" switches to any other editor.
 * https://code.visualstudio.com/api/extension-guides/custom-editors
 */
export class InspectorEditorProvider implements vscode.CustomReadonlyEditorProvider<InspectorDocument> {
  private readonly panels = new Map<InspectorDocument, Set<vscode.WebviewPanel>>();
  private readonly states = new Map<InspectorDocument, DocumentState>();
  /** The parse in flight per document, so a reloaded webview joins it instead of restarting it. */
  private readonly loads = new Map<
    InspectorDocument,
    {
      readonly revision: number;
      readonly controller: AbortController;
      readonly done: Promise<void>;
    }
  >();

  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly log: Log,
    /** VS Code's per-extension storage; holds only the pane layout, never file data. */
    private readonly memory: vscode.Memento,
  ) {}

  private get layout(): PaneLayout {
    return this.memory.get<PaneLayout>(LAYOUT_KEY) ?? DEFAULT_LAYOUT;
  }

  /** Registers the provider; the returned disposable belongs in `context.subscriptions`. */
  static register(context: vscode.ExtensionContext, log: Log): vscode.Disposable {
    const provider = new InspectorEditorProvider(context.extensionUri, log, context.globalState);
    return vscode.Disposable.from(
      vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
        // Hidden editors restore from host state instead of staying alive.
        webviewOptions: { retainContextWhenHidden: false },
        supportsMultipleEditorsPerDocument: true,
      }),
      // A new parser path only changes DICOM results; NIfTI never uses go-dicom.
      onParserSettingChanged(() => {
        for (const doc of provider.panels.keys()) {
          if (doc.format === 'dicom') void provider.load(doc, true);
        }
      }),
      ...(TEST_HOOKS ? [provider.registerTestCommand()] : []),
    );
  }

  /** Test only: `dicomTrace.test.ui(uri, action)` → the webview's UI state. */
  private registerTestCommand(): vscode.Disposable {
    return vscode.commands.registerCommand(
      'dicomTrace.test.ui',
      async (uri: string, action: Record<string, unknown> = { kind: 'snapshot' }) => {
        const doc = [...this.panels.keys()].find((d) => d.uri.toString() === uri);
        const panel = doc ? [...(this.panels.get(doc) ?? [])][0] : undefined;
        if (!doc || !panel) return undefined;
        const token = `${Date.now()}-${Math.random()}`;
        const reply = new Promise<unknown>((resolve) => {
          const timer = setTimeout(() => {
            testReplies.delete(token);
            resolve(undefined);
          }, 10_000);
          testReplies.set(token, (state) => {
            clearTimeout(timer);
            testReplies.delete(token);
            resolve(state);
          });
        });
        await panel.webview.postMessage({ type: 'test', token, action });
        return reply;
      },
    );
  }

  async openCustomDocument(uri: vscode.Uri): Promise<InspectorDocument> {
    const doc = await InspectorDocument.open(uri);
    this.log.event('opened', {
      kilobytes: Math.round(doc.fileSize / 1024),
      nifti: doc.format === 'nifti',
    });
    doc.onDidChange(() => {
      this.log.event('fileChanged', { revision: doc.revision });
      void this.load(doc);
    });
    return doc;
  }

  resolveCustomEditor(doc: InspectorDocument, panel: vscode.WebviewPanel): void {
    const set = this.panels.get(doc) ?? new Set();
    set.add(panel);
    this.panels.set(doc, set);

    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
    const { webview } = panel;
    webview.options = { enableScripts: true, localResourceRoots: [dist] };
    webview.onDidReceiveMessage((raw: unknown) => {
      void this.handle(doc, panel, raw);
    });
    panel.onDidDispose(() => {
      set.delete(panel);
      if (set.size === 0) {
        this.loads.get(doc)?.controller.abort();
        this.loads.delete(doc);
        this.states.delete(doc);
        this.panels.delete(doc);
        this.log.event('closed');
      }
    });
    webview.html = webviewHtml({
      nonce: randomBytes(16).toString('base64'),
      cspSource: webview.cspSource,
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js')).toString(),
      workerUri: webview.asWebviewUri(vscode.Uri.joinPath(dist, 'decodeWorker.js')).toString(),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css')).toString(),
      testHooks: TEST_HOOKS,
    });
  }

  /** Every webview message is untrusted input. */
  private async handle(
    doc: InspectorDocument,
    panel: vscode.WebviewPanel,
    raw: unknown,
  ): Promise<void> {
    if (
      TEST_HOOKS &&
      typeof raw === 'object' &&
      raw !== null &&
      (raw as { type?: unknown }).type === 'testState'
    ) {
      const { token, state } = raw as { token?: unknown; state?: unknown };
      if (typeof token === 'string') testReplies.get(token)?.(state);
      return;
    }
    const msg = parseWebviewMessage(raw);
    if (!msg) return;
    switch (msg.type) {
      case 'ready': {
        await panel.webview.postMessage({ type: 'layout', ...this.layout } satisfies HostMessage);
        // A webview reloads whenever its tab is shown again. Replay the result, or let
        // the parse in flight deliver it (it posts to every panel, this one included).
        const state = this.states.get(doc);
        if (state?.revision === doc.revision) {
          for (const m of state.messages) await panel.webview.postMessage(m);
        } else {
          await this.load(doc, false);
        }
        return;
      }
      case 'readBytes': {
        const check = checkRead(msg, {
          documentId: doc.id,
          revision: doc.revision,
          fileSize: doc.fileSize,
        });
        const base: Revisioned = { documentId: msg.documentId, revision: msg.revision };
        if (!check.ok) {
          this.log.event('readRefused', { offset: msg.offset, length: msg.length });
          const message =
            check.reason === 'staleRevision'
              ? 'The file changed; reloading.'
              : 'This read was refused.';
          await panel.webview.postMessage({
            type: 'bytesFailed',
            ...base,
            offset: msg.offset,
            message,
          } satisfies HostMessage);
          return;
        }
        try {
          const data = await doc.read(check.offset, check.length);
          this.log.event('bytesRead', { length: data.byteLength });
          await panel.webview.postMessage({
            type: 'bytes',
            ...base,
            offset: check.offset,
            data,
          } satisfies HostMessage);
        } catch {
          await panel.webview.postMessage({
            type: 'bytesFailed',
            ...base,
            offset: check.offset,
            message: 'The file could not be read.',
          } satisfies HostMessage);
        }
        return;
      }
      case 'layout':
        await this.memory.update(LAYOUT_KEY, {
          image: msg.image,
          tags: msg.tags,
          bytes: msg.bytes,
        });
        return;
      case 'imageStatus':
        this.log.event(msg.status === 'rendered' ? 'imageRendered' : 'imageFailed', { ms: msg.ms });
        return;
    }
  }

  /**
   * Parses the current revision and sends the result to every panel of the document.
   * Joins a parse already in flight for this revision unless `force` (the parser setting
   * changed); a new revision or `force` cancels the old one.
   */
  private load(doc: InspectorDocument, force = true): Promise<void> {
    const inFlight = this.loads.get(doc);
    if (inFlight && !force && inFlight.revision === doc.revision) return inFlight.done;
    inFlight?.controller.abort();
    const controller = new AbortController();
    const done = (async () => {
      const messages = await this.describe(doc, controller.signal);
      // A newer revision or a closed editor makes this result stale: drop it.
      if (!messages || controller.signal.aborted) return;
      this.states.set(doc, { revision: messages.revision, messages: messages.list });
      for (const panel of this.panels.get(doc) ?? []) {
        for (const m of messages.list) await panel.webview.postMessage(m);
      }
    })().finally(() => {
      if (this.loads.get(doc)?.controller === controller) this.loads.delete(doc);
    });
    this.loads.set(doc, { revision: doc.revision, controller, done });
    return done;
  }

  private async describe(
    doc: InspectorDocument,
    signal: AbortSignal,
  ): Promise<{ revision: number; list: HostMessage[] } | null> {
    const revision = doc.revision;
    const ids = { documentId: doc.id, revision };
    const base = { ...ids, fileName: doc.fileName, fileSize: doc.fileSize };
    const started = Date.now();
    const list: HostMessage[] = [];
    const elapsed = (): number => Date.now() - started;

    if (doc.format === 'dicom') {
      try {
        const json = await showJson(goDicomPath(), doc.uri.fsPath, signal);
        const result = normaliseGoDicom(json, doc.fileSize);
        if (result.ok) {
          const { inspection } = result;
          list.push({
            type: 'opened',
            format: 'dicom',
            ...base,
            inspection,
            object: objectInfo(inspection),
          });
          this.log.event('parsed', {
            ms: elapsed(),
            elements: countElements(inspection.fileMeta) + countElements(inspection.dataSet),
            partial: inspection.partial,
          });
        } else {
          list.push({ type: 'parseFailed', format: 'dicom', ...base, message: result.error });
          this.log.event('parseFailed', { ms: elapsed() });
        }
      } catch (error) {
        if (signal.aborted) return null;
        const kind = error instanceof GoDicomError ? error.kind : 'failed';
        const message =
          error instanceof GoDicomError ? error.message : 'The file could not be parsed.';
        list.push({ type: 'parseFailed', format: 'dicom', ...base, message });
        const event =
          kind === 'notFound'
            ? 'parserMissing'
            : kind === 'tooOld'
              ? 'parserTooOld'
              : 'parseFailed';
        this.log.event(event, { ms: elapsed() });
      }
      list.push(await this.imageBytes(doc, ids));
    } else {
      try {
        if (doc.fileSize > MAX_IMAGE_BYTES) {
          list.push({
            type: 'parseFailed',
            format: 'nifti',
            ...base,
            message: 'The file is too large to open (over 512 MB).',
          });
          return { revision, list };
        }
        const raw = new Uint8Array(await readFile(doc.uri.fsPath, { signal }));
        const compressed = doc.uri.path.toLowerCase().endsWith('.gz');
        // Bounded inflate: a small .nii.gz must not expand into gigabytes. zlib's gunzip
        // takes no signal, so a cancelled load is dropped once it finishes.
        const stream = compressed
          ? new Uint8Array(await gunzipAsync(raw, { maxOutputLength: MAX_INFLATED_BYTES }))
          : raw;
        if (signal.aborted) return null;
        const parsed = parseNiftiHeader(stream, true);
        if (parsed.ok) {
          list.push({
            type: 'opened',
            format: 'nifti',
            ...base,
            nifti: niftiView(parsed.header, stream.byteLength, compressed),
          });
          list.push({ type: 'imageData', ...ids, data: stream });
          this.log.event('parsed', {
            ms: elapsed(),
            version: parsed.header.version,
            compressed,
          });
        } else {
          list.push({ type: 'parseFailed', format: 'nifti', ...base, message: parsed.error });
          this.log.event('parseFailed', { ms: elapsed() });
        }
      } catch {
        if (signal.aborted) return null;
        list.push({
          type: 'parseFailed',
          format: 'nifti',
          ...base,
          message: 'The file could not be read or inflated as NIfTI.',
        });
        this.log.event('parseFailed', { ms: elapsed() });
      }
    }
    return revision === doc.revision ? { revision, list } : null;
  }

  /** The whole DICOM file for the image pane, when it is small enough. */
  private async imageBytes(doc: InspectorDocument, ids: Revisioned): Promise<HostMessage> {
    if (doc.fileSize > MAX_IMAGE_BYTES) {
      return {
        type: 'imageUnavailable',
        ...ids,
        message: 'The file is too large to show as an image (over 512 MB).',
      };
    }
    try {
      return { type: 'imageData', ...ids, data: new Uint8Array(await readFile(doc.uri.fsPath)) };
    } catch {
      return { type: 'imageUnavailable', ...ids, message: 'The file could not be read.' };
    }
  }
}
