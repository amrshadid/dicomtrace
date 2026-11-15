/**
 * Cornerstone's decode worker as a single-file IIFE bundle. The module is
 * not in the package's `exports`, so esbuild.mjs aliases this specifier to its file. It
 * calls comlink's `expose` on import, which is all the worker needs.
 */
import 'cornerstone-decode-worker';
