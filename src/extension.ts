import type * as vscode from 'vscode';
import { Log } from './adapters/log';

/** Composition root: wire adapters to the core and register everything for disposal. */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(new Log());
}

/** Nothing to do: every resource is in `context.subscriptions`. */
export function deactivate(): void {
  // Intentionally empty.
}
