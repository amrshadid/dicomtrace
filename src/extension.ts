import type * as vscode from 'vscode';
import { InspectorEditorProvider } from './adapters/editorProvider';
import { Log } from './adapters/log';

/** Composition root: wire adapters to the core and register everything for disposal. */
export function activate(context: vscode.ExtensionContext): void {
  const log = new Log();
  context.subscriptions.push(log, InspectorEditorProvider.register(context, log));
}

/** Nothing to do: every resource is in `context.subscriptions`. */
export function deactivate(): void {
  // Intentionally empty.
}
