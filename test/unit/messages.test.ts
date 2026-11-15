import { describe, expect, it } from 'vitest';
import { PAGE_SIZE } from '../../src/core/hexPaging';
import {
  DEFAULT_LAYOUT,
  checkRead,
  isCurrent,
  parseWebviewMessage,
} from '../../src/protocol/messages';

const read = {
  type: 'readBytes',
  documentId: 'doc-1',
  revision: 3,
  offset: 128,
  length: 4096,
} as const;
const doc = { documentId: 'doc-1', revision: 3, fileSize: 9830 };

describe('parseWebviewMessage', () => {
  it('accepts the known shapes and drops unknown fields', () => {
    expect(parseWebviewMessage({ type: 'ready', extra: 1 })).toEqual({ type: 'ready' });
    expect(parseWebviewMessage({ ...read, path: '/etc/passwd' })).toEqual(read);
    expect(
      parseWebviewMessage({
        type: 'imageStatus',
        documentId: 'doc-1',
        revision: 3,
        status: 'failed',
        ms: 12,
      }),
    ).toEqual({ type: 'imageStatus', documentId: 'doc-1', revision: 3, status: 'failed', ms: 12 });
  });

  it('accepts a pane layout with at least one visible pane', () => {
    expect(parseWebviewMessage({ type: 'layout', image: true, tags: true, bytes: false })).toEqual({
      type: 'layout',
      image: true,
      tags: true,
      bytes: false,
    });
  });

  it.each([
    ['a layout hiding every pane', { type: 'layout', image: false, tags: false, bytes: false }],
    ['a layout with a non-boolean', { type: 'layout', image: 'yes', tags: true, bytes: true }],
    ['null', null],
    ['an array', [read]],
    ['an unknown type', { type: 'writeFile' }],
    ['a negative offset', { ...read, offset: -1 }],
    ['a fractional length', { ...read, length: 1.5 }],
    ['a string offset', { ...read, offset: '0' }],
    ['a huge offset', { ...read, offset: 2 ** 60 }],
    ['an empty document id', { ...read, documentId: '' }],
    ['an over-long document id', { ...read, documentId: 'x'.repeat(65) }],
    [
      'a bad image status',
      { type: 'imageStatus', documentId: 'd', revision: 1, status: 'ok', ms: 1 },
    ],
  ])('rejects %s', (_label, input) => {
    expect(parseWebviewMessage(input)).toBeNull();
  });
});

describe('checkRead', () => {
  it('allows a read inside the current revision', () => {
    expect(checkRead(read, doc)).toEqual({ ok: true, offset: 128, length: 4096 });
  });

  it('shortens a read that runs past the end, so the last page works', () => {
    expect(checkRead({ ...read, offset: 9800 }, doc)).toEqual({
      ok: true,
      offset: 9800,
      length: 30,
    });
    expect(checkRead({ ...read, offset: 9830 }, doc)).toEqual({
      ok: true,
      offset: 9830,
      length: 0,
    });
  });

  it.each([
    ['another document', { ...read, documentId: 'doc-2' }, 'wrongDocument'],
    ['a stale revision', { ...read, revision: 2 }, 'staleRevision'],
    ['more than a page', { ...read, length: PAGE_SIZE + 1 }, 'tooLong'],
    ['an offset past the end', { ...read, offset: 9831 }, 'outOfRange'],
  ] as const)('refuses %s', (_label, msg, reason) => {
    expect(checkRead(msg, doc)).toEqual({ ok: false, reason });
  });
});

describe('isCurrent', () => {
  it('drops messages for another document or revision', () => {
    expect(isCurrent({ documentId: 'a', revision: 1 }, { documentId: 'a', revision: 1 })).toBe(
      true,
    );
    expect(isCurrent({ documentId: 'a', revision: 1 }, { documentId: 'a', revision: 2 })).toBe(
      false,
    );
    expect(isCurrent({ documentId: 'a', revision: 1 }, null)).toBe(false);
  });
});

describe('DEFAULT_LAYOUT', () => {
  it('shows the image and the tags; the hex pane is opt-in', () => {
    expect(DEFAULT_LAYOUT).toEqual({ image: true, tags: true, bytes: false });
  });
});
