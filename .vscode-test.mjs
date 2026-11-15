// Integration tests run inside a separately downloaded VS Code build with an
// isolated user-data and extensions directory, so they never touch your
// installed editor, settings or other open projects.
//
// GO_DICOM_PATH (an absolute path to go-dicom 1.9.1 or later) enables the tests that
// need the parser; without it they are skipped.
import { defineConfig } from '@vscode/test-cli';

// Occluded test windows get their timers and rAF throttled by Chromium, which made
// webview tests stall. Keep a known boolean flag last: VS Code's CLI parser treats an
// unknown flag as taking a value and would swallow the workspace folder after it.
const steady = [
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
];

const common = {
  workspaceFolder: './test/fixtures/dicom',
  mocha: { ui: 'tdd', timeout: 30000 },
};

// DT_TEST_HOOKS lets tests read the webview's state (src/webview/testHooks.ts).
const env = { DT_TEST_HOOKS: '1', GO_DICOM_PATH: process.env.GO_DICOM_PATH ?? '' };

export default defineConfig([
  {
    ...common,
    label: 'main',
    files: ['out/test/integration/suite/**/*.test.js', 'out/test/integration/tools/**/*.test.js'],
    env,
    launchArgs: [...steady, '--disable-extensions'],
  },
  {
    // A HiDPI screen with no WebGL: Cornerstone renders on the CPU, the case where its
    // own zoom tool collapses the image. Guards our zoom and frame handlers.
    ...common,
    label: 'hidpi-cpu',
    files: 'out/test/integration/tools/**/*.test.js',
    env: { ...env, DT_EXPECT_CPU: '1' },
    launchArgs: [
      ...steady,
      '--force-device-scale-factor=2',
      '--disable-gpu',
      '--disable-webgl',
      '--disable-extensions',
    ],
  },
]);
