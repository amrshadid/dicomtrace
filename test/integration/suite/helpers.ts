import * as vscode from 'vscode';

export const VIEW_TYPE = 'dicomTrace.inspector';

/** What the webview reports through its test hook (src/webview/testHooks.ts). */
export interface UiState {
  title: string[];
  banners: string[];
  tagRows: number;
  tagSections: string[];
  selectedRow: string;
  status: string;
  hexRows: number;
  hexFirstRow: string;
  hexSelectedBytes: number;
  hexTagBytes: number;
  hexPendingBytes: number;
  hexNote: string;
  imageInfo: string;
  imageNote: string;
  image: {
    width: number;
    height: number;
    litFraction: number;
    opaque: number;
    distinct: number;
    /** A hash of the red channel: changes when the picture moves. */
    hash: number;
  } | null;
  overlay: { opaque: number } | null;
  overlayButtonVisible: boolean;
  /** Visibility of the image, tags and bytes panes, in that order. */
  panes: boolean[];
  /** The frame slider under the image (1-based value). */
  frameBar: { visible: boolean; value: number; max: number; label: string };
  violations: string[];
  errors: string[];
}

export type Action =
  | { kind: 'snapshot' }
  | { kind: 'select'; id: string }
  | { kind: 'clickByte'; offset: number }
  | { kind: 'togglePane'; name: 'image' | 'tags' | 'bytes' }
  | { kind: 'wheel'; deltaY: number }
  | { kind: 'setFrame'; index: number }
  | { kind: 'toggleGrouping' }
  | { kind: 'clickTool'; id: string }
  | { kind: 'setWindow'; width: number; level: number }
  | { kind: 'play'; ms: number }
  | { kind: 'drag'; button: 0 | 1 | 2; dx: number; dy: number };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Asks the webview for its state (after performing `action`); throws if it doesn't answer. */
export async function ui(uri: vscode.Uri, action: Action = { kind: 'snapshot' }): Promise<UiState> {
  const state = await vscode.commands.executeCommand<UiState | undefined>(
    'dicomTrace.test.ui',
    uri.toString(),
    action,
  );
  if (!state) throw new Error('the webview did not answer');
  return state;
}

/** Polls the UI until `done` holds, or returns the last state after `timeoutMs`. */
export async function waitForUi(
  uri: vscode.Uri,
  done: (s: UiState) => boolean,
  timeoutMs = 20000,
): Promise<UiState> {
  const deadline = Date.now() + timeoutMs;
  let last: UiState | undefined;
  while (Date.now() < deadline) {
    last = await ui(uri).catch(() => undefined);
    if (last && done(last)) return last;
    await sleep(200);
  }
  if (!last) throw new Error('the webview never answered');
  return last;
}

export async function openInInspector(uri: vscode.Uri): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
}

export async function closeAll(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(200);
}

/** The image has finished: drawn, or a note explains why not. */
export const imageSettled = (s: UiState): boolean =>
  (s.image !== null && s.image.litFraction > 0) ||
  (s.imageNote !== '' && !s.imageNote.startsWith('Loading'));
