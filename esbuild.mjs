// Builds dist/extension.js: Node / CommonJS, the extension host. `vscode` is provided at
// runtime. The webview bundles join it when the panes exist.
// A production build fails if a bundle exceeds its size budget.
import * as esbuild from 'esbuild';
import { rmSync, statSync } from 'node:fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const KB = 1024;
/** Activation stays fast. */
const EXTENSION_BUDGET_BYTES = 64 * KB;

/** @type {import('esbuild').BuildOptions} */
const extension = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  entryPoints: ['src/extension.ts'],
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  outfile: 'dist/extension.js',
  external: ['vscode'],
};

// Start clean so no stale file from an earlier build ships in the VSIX.
rmSync('dist', { recursive: true, force: true });

if (watch) {
  const ctx = await esbuild.context(extension);
  await ctx.watch();
} else {
  await esbuild.build(extension);
  if (production) {
    const size = statSync('dist/extension.js').size;
    const line = `dist/extension.js: ${(size / KB).toFixed(1)} KB (budget ${EXTENSION_BUDGET_BYTES / KB} KB)`;
    if (size > EXTENSION_BUDGET_BYTES) {
      console.error(`Over budget: ${line}`);
      process.exit(1);
    }
    console.log(line);
  }
}
