import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, webviewHtml } from '../../src/core/webviewHtml';

const input = {
  nonce: 'abc123',
  cspSource: 'https://file+.vscode-resource.vscode-cdn.net',
  scriptUri: 'https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview.js',
  workerUri: 'https://file+.vscode-resource.vscode-cdn.net/ext/dist/decodeWorker.js',
  styleUri: 'https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview.css',
};

describe('contentSecurityPolicy', () => {
  const csp = contentSecurityPolicy(input.nonce, input.cspSource);

  it('denies everything by default and allows only the nonce script', () => {
    expect(csp).toMatch(/^default-src 'none';/);
    expect(csp).toContain("script-src 'nonce-abc123'");
  });

  it('never allows eval, inline code or WASM compilation', () => {
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('wasm-unsafe-eval');
  });

  it('allows workers only from blob URLs', () => {
    expect(csp).toContain('worker-src blob:');
  });

  it('names no network origin other than the extension resource origin', () => {
    const origins = csp.match(/https?:\/\/[^\s;]+/g) ?? [];
    expect(new Set(origins)).toEqual(new Set([input.cspSource]));
  });
});

describe('webviewHtml', () => {
  it('loads exactly one script, with the nonce', () => {
    const html = webviewHtml(input);
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain(
      `<script type="module" nonce="abc123" src="${input.scriptUri}"></script>`,
    );
  });

  it('loads the stylesheet from the extension, not inline', () => {
    const html = webviewHtml(input);
    expect(html).toContain(`<link rel="stylesheet" href="${input.styleUri}">`);
    expect(html).not.toContain('<style');
    expect(html).not.toContain('style=');
  });

  it('escapes attribute values', () => {
    const html = webviewHtml({ ...input, workerUri: 'x" onload="alert(1)' });
    expect(html).toContain('data-worker-uri="x&quot; onload=&quot;alert(1)"');
  });
});
