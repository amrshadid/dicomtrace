/**
 * The image tools, driven with real input events: wheel for frames or slices, left drag
 * for window/level, right drag for zoom, middle drag for pan. Runs twice: in the normal
 * configuration, and in "hidpi-cpu" (device scale factor 2, WebGL off), the case where
 * Cornerstone's own zoom tool collapses the image and our handler must take over.
 */
import * as assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import * as vscode from 'vscode';
import type { UiState } from '../suite/helpers';
import { closeAll, imageSettled, openInInspector, ui, waitForUi } from '../suite/helpers';

const FIXTURES = resolve(__dirname, '../../../../test/fixtures');
const GO_DICOM = process.env.GO_DICOM_PATH ?? '';
const CPU = process.env.DT_EXPECT_CPU === '1';

interface Info {
  index: number;
  width: number;
  level: number;
  zoom: number;
}

function info(s: UiState): Info {
  const index = /(?:frame|slice) (\d+)\//.exec(s.imageInfo);
  const wl = /W (-?[\d.e+-]+) L (-?[\d.e+-]+)/.exec(s.imageInfo);
  const zoom = /zoom ([\d.]+)/.exec(s.imageInfo);
  assert.ok(index && wl && zoom, `unexpected image info: ${s.imageInfo}`);
  return {
    index: Number(index[1]),
    width: Number(wl[1]),
    level: Number(wl[2]),
    zoom: Number(zoom[1]),
  };
}

/** Polls until the image info satisfies `done`: renders can lag input on slow machines. */
async function waitForInfo(
  uri: vscode.Uri,
  done: (i: Info, s: UiState) => boolean,
): Promise<UiState> {
  return waitForUi(uri, (s) => /W -?[\d.e+-]+ L/.test(s.imageInfo) && done(info(s), s), 5000);
}

async function exercise(uri: vscode.Uri, unit: 'frame' | 'slice', count: number): Promise<void> {
  await openInInspector(uri);
  const start = await waitForUi(uri, (s) => imageSettled(s) && s.imageInfo.includes(unit));
  assert.equal(start.imageNote, '', start.imageNote);
  // On Windows, Chromium still offers software WebGL (WARP) despite --disable-webgl, so
  // Cornerstone may stay on its GPU path there; the flags force CPU on Linux and macOS.
  if (CPU && unit === 'frame' && process.platform !== 'win32') {
    assert.ok(start.imageInfo.includes('CPU rendering'), start.imageInfo);
  }

  // The frame bar and the toolbar don't depend on the scale factor or the GPU, so they are
  // checked in the main configuration (on Linux, macOS and Windows in CI). The HiDPI CPU
  // run focuses on what it exists for: wheel, window/level, zoom (the collapse) and pan.
  if (!CPU) {
    assert.ok(start.frameBar.visible, 'frame bar shown');
    assert.equal(start.frameBar.max, count);
    await ui(uri, { kind: 'setFrame', index: 3 });
    const scrubbed = await waitForInfo(uri, (i) => i.index === 3);
    assert.equal(info(scrubbed).index, 3, `the slider moves the image: ${scrubbed.imageInfo}`);
    assert.ok(scrubbed.frameBar.label.startsWith(`${unit} 3 / ${count}`), scrubbed.frameBar.label);
    const played = await ui(uri, { kind: 'play', ms: 900 });
    assert.notEqual(info(played).index, 3, `Play advances: ${played.imageInfo}`);
    assert.equal(played.frameBar.value, info(played).index, 'slider follows playback');
    await ui(uri, { kind: 'setFrame', index: 1 });
    await waitForInfo(uri, (i) => i.index === 1);
  }

  const a = info(await ui(uri));
  await ui(uri, { kind: 'wheel', deltaY: 100 });
  const wheeled = await waitForInfo(uri, (i) => i.index === a.index + 1);
  assert.equal(info(wheeled).index, a.index + 1, `wheel moves one ${unit}: ${wheeled.imageInfo}`);

  const before = info(wheeled);
  const leveled = await ui(uri, { kind: 'drag', button: 0, dx: 80, dy: 40 });
  const b = info(leveled);
  assert.ok(b.width > before.width, `left drag right widens the window: ${leveled.imageInfo}`);
  assert.ok(b.level > before.level, `left drag down raises the level: ${leveled.imageInfo}`);

  const zoomed = await ui(uri, { kind: 'drag', button: 2, dx: 0, dy: -60 });
  const z = info(zoomed);
  assert.ok(z.zoom > b.zoom * 1.2, `right drag up zooms in: ${zoomed.imageInfo}`);
  assert.ok(
    z.zoom < b.zoom * 4,
    `zoom stays proportional (no collapse or jump): ${zoomed.imageInfo}`,
  );

  await ui(uri, { kind: 'drag', button: 1, dx: 60, dy: 30 });
  const panned = await waitForInfo(uri, (_, s) => s.image?.hash !== zoomed.image?.hash);
  const p = info(panned);
  assert.notEqual(panned.image?.hash, zoomed.image?.hash, 'middle drag moves the image');
  assert.equal(p.width, z.width, 'pan leaves window/level alone');
  assert.equal(p.zoom, z.zoom, 'pan leaves zoom alone');

  if (!CPU) {
    // The toolbar: the same tools on both renderers.
    const zoomIn = await ui(uri, { kind: 'clickTool', id: 'zoomIn' });
    assert.ok(
      Math.abs(info(zoomIn).zoom / p.zoom - 1.25) < 0.02,
      `Zoom + is ×1.25: ${zoomIn.imageInfo}`,
    );
    const typed = await ui(uri, { kind: 'setWindow', width: 500, level: 300 });
    assert.equal(info(typed).width, 500, `typed width applies: ${typed.imageInfo}`);
    assert.equal(info(typed).level, 300, `typed level applies: ${typed.imageInfo}`);
    const auto = await ui(uri, { kind: 'clickTool', id: 'auto' });
    assert.notEqual(info(auto).width, 500, `Auto fits the window: ${auto.imageInfo}`);
    await ui(uri, { kind: 'clickTool', id: 'pan' });
    const beforePan = await ui(uri);
    await ui(uri, { kind: 'drag', button: 0, dx: 40, dy: 20 });
    const leftPan = await waitForInfo(uri, (_, s) => s.image?.hash !== beforePan.image?.hash);
    assert.notEqual(
      leftPan.image?.hash,
      beforePan.image?.hash,
      'in Pan mode a left drag moves the image',
    );
    assert.equal(info(leftPan).width, info(beforePan).width, 'and leaves window/level alone');
    await ui(uri, { kind: 'clickTool', id: 'contrast' });
    const leftWl = await ui(uri, { kind: 'drag', button: 0, dx: 40, dy: 0 });
    assert.notEqual(
      info(leftWl).width,
      info(leftPan).width,
      'back in Contrast mode a left drag changes W/L',
    );
  }

  const last = await ui(uri);
  assert.deepEqual(last.violations, []);
  assert.deepEqual(last.errors, []);
}

suite(`Image tools${CPU ? ' (HiDPI, CPU rendering)' : ''}`, function () {
  this.timeout(60000);

  suiteSetup(async () => {
    await vscode.workspace
      .getConfiguration('dicomTrace')
      .update('goDicomPath', GO_DICOM, vscode.ConfigurationTarget.Global);
  });

  teardown(closeAll);

  test('DICOM stack (Cornerstone): wheel, window/level, zoom, pan', async function () {
    if (!GO_DICOM) this.skip();
    await exercise(vscode.Uri.file(join(FIXTURES, 'dicom', 'emri_small.dcm')), 'frame', 10);
  });

  test('NIfTI volume (our renderer): wheel, window/level, zoom, pan', async () => {
    await exercise(vscode.Uri.file(join(FIXTURES, 'nifti', 'anatomical.nii')), 'slice', 25);
  });

  test('single-frame images have no frame bar', async () => {
    const uri = vscode.Uri.file(join(FIXTURES, 'nifti', 'example_nifti2.nii'));
    await openInInspector(uri);
    const nifti4d = await waitForUi(uri, (s) => imageSettled(s));
    assert.ok(nifti4d.frameBar.visible, '12 slices and 2 volumes: shown');
    await closeAll();
    if (!GO_DICOM) return;
    const single = vscode.Uri.file(join(FIXTURES, 'dicom', 'MR_small.dcm'));
    await openInInspector(single);
    const s = await waitForUi(single, (x) => imageSettled(x));
    assert.equal(s.frameBar.visible, false, 'one frame: hidden');
  });
});
