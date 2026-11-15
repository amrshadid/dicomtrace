import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const VIEW_TYPE = 'dicomTrace.inspector';

suite('Inspector editor', () => {
  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('opens a DICOM file read-only through Open With', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'the fixture folder is open');
    const uri = vscode.Uri.joinPath(folder.uri, 'MR_small.dcm');
    const before = await vscode.workspace.fs.readFile(uri);

    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);

    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(tab?.input instanceof vscode.TabInputCustom, 'a custom editor tab is active');
    assert.equal(tab.input.viewType, VIEW_TYPE);
    assert.equal(tab.input.uri.toString(), uri.toString());

    // Product promise: source files are never written.
    const after = await vscode.workspace.fs.readFile(uri);
    assert.deepEqual(after, before);
  });

  test('opens DICOM and NIfTI files by default (VS Code cannot show them as text)', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    for (const file of [
      vscode.Uri.joinPath(folder.uri, 'MR_small.dcm'),
      vscode.Uri.joinPath(folder.uri, '..', 'nifti', 'anatomical.nii'),
      vscode.Uri.joinPath(folder.uri, '..', 'nifti', 'example4d.nii.gz'),
    ]) {
      await vscode.commands.executeCommand('vscode.open', file);
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      const isOurs =
        tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE;
      assert.ok(isOurs, `${file.path} opens in the inspector`);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });
});
