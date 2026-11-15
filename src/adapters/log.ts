import * as vscode from 'vscode';
import type { LogData, LogEvent } from '../core/logFormat';
import { formatLogEvent } from '../core/logFormat';

/**
 * The "DicomTrace" output channel. Only lines `formatLogEvent` accepts are
 * written: event names and numbers, never tag values, paths or bytes.
 */
export class Log implements vscode.Disposable {
  private readonly channel = vscode.window.createOutputChannel('DicomTrace', {
    log: true,
  });

  /** Logs one event; data that `formatLogEvent` rejects is dropped, never written. */
  event(event: LogEvent, data: LogData = {}): void {
    const line = formatLogEvent(event, data);
    if (line !== null) this.channel.info(line);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
