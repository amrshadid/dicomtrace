/**
 * Log lines for the output channel. DICOM files can carry PHI, so a log line
 * may only contain an event name from a fixed list and numbers or booleans. Strings are
 * refused at runtime too, so a tag value, a path or raw bytes can never reach the log,
 * even through a type cast.
 */

export type LogEvent =
  | 'opened'
  | 'parsed'
  | 'parseFailed'
  | 'parserMissing'
  | 'parserTooOld'
  | 'bytesRead'
  | 'readRefused'
  | 'imageRendered'
  | 'imageFailed'
  | 'fileChanged'
  | 'closed';

const EVENTS: ReadonlySet<string> = new Set<LogEvent>([
  'opened',
  'parsed',
  'parseFailed',
  'parserMissing',
  'parserTooOld',
  'bytesRead',
  'readRefused',
  'imageRendered',
  'imageFailed',
  'fileChanged',
  'closed',
]);

export type LogData = Readonly<Record<string, number | boolean>>;

const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;

/**
 * Formats a log line, or returns null when anything in it is not allowed.
 *
 * @example formatLogEvent('parsed', { ms: 42, elements: 81 }) → "parsed ms=42 elements=81"
 */
export function formatLogEvent(event: LogEvent, data: LogData = {}): string | null {
  if (!EVENTS.has(event)) return null;
  const parts: string[] = [event];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (!KEY.test(key)) return null;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      parts.push(`${key}=${Math.round(value * 1000) / 1000}`);
    } else if (typeof value === 'boolean') {
      parts.push(`${key}=${String(value)}`);
    } else {
      return null;
    }
  }
  return parts.join(' ');
}
