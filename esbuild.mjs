// Builds the three bundles:
// - dist/extension.js     Node / CommonJS, the extension host. `vscode` is provided at runtime.
// - dist/webview.js(+css) Browser ESM, the panes. The Cornerstone viewer is a lazy chunk
//                         in dist/chunks/, loaded with import() only when a DICOM image
//                         is shown. Loaded with a CSP nonce.
// - dist/decodeWorker.js  Browser IIFE, Cornerstone's decode worker. Webviews only allow
//                         single-file blob/data workers, so the webview fetches this bundle
//                         and starts it from a Blob URL.
//                         https://code.visualstudio.com/api/extension-guides/webview#using-web-workers
// A production build fails if a bundle exceeds its size budget.
import * as esbuild from 'esbuild';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const KB = 1024;
/** Size budgets for the minified bundles. */
const BUDGETS = [
  // Activation stays fast.
  { label: 'dist/extension.js', files: ['dist/extension.js'], bytes: 64 * KB },
  // Loaded for every file opened, before any image: the panes stay light.
  { label: 'dist/webview.js', files: ['dist/webview.js'], bytes: 128 * KB },
  // Everything the webview can load, Cornerstone and its codecs included.
  { label: 'browser JavaScript', files: 'browser', bytes: 5.5 * KB * KB },
];

// The decode worker is not in the package's `exports`, so resolve its file directly.
const require = createRequire(import.meta.url);
const loaderDir = dirname(require.resolve('@cornerstonejs/dicom-image-loader/package.json'));
const decodeWorker = join(loaderDir, 'dist/esm/decodeImageFrameWorker.js');

/** Emscripten codecs reference Node's fs/path behind runtime checks; the browser gets stubs. */
const nodeStubs = {
  name: 'node-stubs',
  setup(build) {
    build.onResolve({ filter: /^(fs|path)$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default {};' }));
  },
};

/** @type {import('esbuild').BuildOptions} */
const shared = { bundle: true, sourcemap: !production, minify: production, logLevel: 'info' };

/** @type {import('esbuild').BuildOptions[]} */
const builds = [
  {
    ...shared,
    entryPoints: ['src/extension.ts'],
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    outfile: 'dist/extension.js',
    external: ['vscode'],
  },
  {
    ...shared,
    entryPoints: { webview: 'src/webview/main.ts' },
    format: 'esm',
    splitting: true,
    platform: 'browser',
    target: 'es2022',
    outdir: 'dist',
    chunkNames: 'chunks/[name]-[hash]',
    plugins: [nodeStubs],
  },
  {
    ...shared,
    entryPoints: ['src/webview/decodeWorker.ts'],
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    outfile: 'dist/decodeWorker.js',
    alias: { 'cornerstone-decode-worker': decodeWorker },
    // The worker is a classic IIFE, where import.meta is empty.
    define: { 'import.meta.url': '"file:///"' },
    plugins: [nodeStubs],
  },
];

// Start clean so no stale chunk from an earlier build ships in the VSIX.
rmSync('dist', { recursive: true, force: true });

if (watch) {
  const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
  if (production) checkBudgets();
}

/** Every file under `dir`, recursively. */
function filesIn(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesIn(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

function checkBudgets() {
  const browserJs = filesIn('dist').filter(
    (f) => f.endsWith('.js') && f !== join('dist', 'extension.js'),
  );
  let over = false;
  for (const { label, files, bytes } of BUDGETS) {
    const list = files === 'browser' ? browserJs : files;
    const size = list.reduce((sum, f) => sum + statSync(f).size, 0);
    const line = `${label}: ${(size / KB).toFixed(1)} KB (budget ${(bytes / KB).toFixed(0)} KB)`;
    if (size > bytes) {
      console.error(`Over budget: ${line}`);
      over = true;
    } else {
      console.log(line);
    }
  }
  if (over) process.exit(1);
}
