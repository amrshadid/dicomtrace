/** Inputs for the webview document. All strings come from the host, never from the file. */
export interface WebviewHtmlInput {
  /** A fresh random nonce per render, used to allow exactly our own script. */
  readonly nonce: string;
  /** `webview.cspSource`, the origin VS Code serves local resources from. */
  readonly cspSource: string;
  /** `webview.asWebviewUri` of `dist/webview.js`. */
  readonly scriptUri: string;
  /** `webview.asWebviewUri` of `dist/webview.css`. */
  readonly styleUri: string;
  /** Integration tests only: lets the webview answer test messages. */
  readonly testHooks?: boolean;
  /** `webview.asWebviewUri` of `dist/decodeWorker.js`, fetched and started as a blob worker. */
  readonly workerUri: string;
}

/**
 * The Content Security Policy for the inspector webview.
 *
 * - No `unsafe-eval` and no `unsafe-inline`: only the script carrying our nonce runs.
 * - `worker-src blob:`: webviews can only start single-file workers from blob or
 *   data URLs (https://code.visualstudio.com/api/extension-guides/webview#using-web-workers).
 * - `connect-src` is limited to the extension's own resources (to fetch the worker
 *   bundle). There is no network origin anywhere in the policy.
 */
export function contentSecurityPolicy(nonce: string, cspSource: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    'worker-src blob:',
    `connect-src ${cspSource}`,
    `img-src ${cspSource} blob: data:`,
    `style-src ${cspSource}`,
    `font-src ${cspSource}`,
  ].join('; ');
}

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Builds the webview's HTML document. Contains no file data; panes ask the host for it. */
export function webviewHtml(input: WebviewHtmlInput): string {
  const csp = contentSecurityPolicy(input.nonce, input.cspSource);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${escapeAttribute(input.styleUri)}">
<title>DicomTrace</title>
</head>
<body data-worker-uri="${escapeAttribute(input.workerUri)}"${input.testHooks ? ' data-test-hooks="1"' : ''}>
<main id="app"></main>
<script type="module" nonce="${escapeAttribute(input.nonce)}" src="${escapeAttribute(input.scriptUri)}"></script>
</body>
</html>`;
}
