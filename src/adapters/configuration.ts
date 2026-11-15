import * as vscode from 'vscode';

const SECTION = 'dicomTrace';

/**
 * The configured go-dicom path, or '' to look it up on PATH.
 *
 * In an untrusted workspace only the user-level value counts: a workspace must never be
 * able to point the extension at an executable it ships (the setting is a
 * `restrictedConfigurations` entry in package.json).
 * https://code.visualstudio.com/api/extension-guides/workspace-trust
 */
export function goDicomPath(): string {
  const config = vscode.workspace.getConfiguration(SECTION);
  if (!vscode.workspace.isTrusted) {
    const inspected = config.inspect<string>('goDicomPath');
    return (inspected?.globalValue ?? '').trim();
  }
  return (config.get<string>('goDicomPath') ?? '').trim();
}

/** Fires when a setting that changes how files are parsed changes. */
export function onParserSettingChanged(listener: () => void): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${SECTION}.goDicomPath`)) listener();
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(listener),
  );
}
