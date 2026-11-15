import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

suite('Activation', () => {
  test('the extension is installed and activates', async () => {
    const ext = vscode.extensions.getExtension('dicomtrace.dicomtrace');
    assert.ok(ext, 'extension found');
    await ext.activate();
    assert.equal(ext.isActive, true);
  });
});
