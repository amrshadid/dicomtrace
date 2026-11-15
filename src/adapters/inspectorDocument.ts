import { randomUUID } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import * as vscode from 'vscode';

/** Which parser and renderer a file goes to, from its name. */
export type FileFormat = 'dicom' | 'nifti';

/** `.nii` and `.nii.gz` are NIfTI; everything else this editor opens is DICOM. */
export function formatOf(uri: vscode.Uri): FileFormat {
  const name = uri.path.toLowerCase();
  return name.endsWith('.nii') || name.endsWith('.nii.gz') ? 'nifti' : 'dicom';
}

/**
 * One open file. Owns a revision number that changes whenever the file on
 * disk changes (by size or mtime), and reads bytes positionally without buffering the
 * whole file. It never writes.
 */
export class InspectorDocument implements vscode.CustomDocument {
  readonly id = randomUUID();
  readonly format: FileFormat;
  private revisionValue = 0;
  private sizeValue = 0;
  private mtime = 0;
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly watcher: vscode.FileSystemWatcher;
  private disposed = false;

  /** Fires after the file changed on disk and the revision moved on. */
  readonly onDidChange = this.changed.event;

  private constructor(readonly uri: vscode.Uri) {
    this.format = formatOf(uri);
    const folder = vscode.Uri.joinPath(uri, '..');
    // Watch the folder's direct children and keep only this file's events. A pattern made
    // from the file name would be read as a glob, and names may contain [ ] { } * ?.
    // https://code.visualstudio.com/api/references/vscode-api#FileSystemWatcher
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, '*'),
    );
    // fsPath normalises the drive letter on Windows, so both sides compare alike.
    const self = uri.fsPath;
    const refresh = (changed: vscode.Uri): void => {
      if (changed.fsPath === self) void this.refresh();
    };
    this.watcher.onDidChange(refresh);
    this.watcher.onDidCreate(refresh);
    this.watcher.onDidDelete(refresh);
  }

  static async open(uri: vscode.Uri): Promise<InspectorDocument> {
    const doc = new InspectorDocument(uri);
    await doc.refresh(false);
    return doc;
  }

  get revision(): number {
    return this.revisionValue;
  }

  get fileSize(): number {
    return this.sizeValue;
  }

  get fileName(): string {
    return this.uri.path.split('/').pop() ?? '';
  }

  /** Re-reads size and mtime; bumps the revision and fires when they changed. */
  private async refresh(notify = true): Promise<void> {
    if (this.disposed) return;
    let size = 0;
    let mtime = 0;
    try {
      const s = await stat(this.uri.fsPath);
      size = s.size;
      mtime = s.mtimeMs;
    } catch {
      // Deleted or unreadable: an empty revision; the panes say the file is gone.
    }
    if (size === this.sizeValue && mtime === this.mtime && notify) return;
    this.sizeValue = size;
    this.mtime = mtime;
    if (notify) {
      this.revisionValue++;
      this.changed.fire();
    }
  }

  /** Reads `length` bytes at `offset` (already checked against this revision). */
  async read(offset: number, length: number): Promise<Uint8Array> {
    const handle = await open(this.uri.fsPath, 'r');
    try {
      const buffer = new Uint8Array(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.watcher.dispose();
    this.changed.dispose();
  }
}
