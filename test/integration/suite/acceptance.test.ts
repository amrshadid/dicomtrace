/**
 * Acceptance tests (proposal §Phase 1 acceptance A1–A5, plus non-image objects, Enhanced
 * multi-frame and NIfTI) in real VS Code, checked through the webview's test hook.
 * Needs GO_DICOM_PATH (go-dicom ≥ 1.9.1) for the DICOM cases.
 */
import * as assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as vscode from 'vscode';
import type { UiState } from './helpers';
import { closeAll, imageSettled, openInInspector, ui, waitForUi } from './helpers';

const FIXTURES = resolve(__dirname, '../../../../test/fixtures');
const GO_DICOM = process.env.GO_DICOM_PATH ?? '';
const dicomUri = (name: string): vscode.Uri =>
  vscode.Uri.file(join(FIXTURES, 'dicom', `${name}.dcm`));
const niftiUri = (name: string): vscode.Uri => vscode.Uri.file(join(FIXTURES, 'nifti', name));

interface Recorded {
  tag: string;
  tagOffset: number;
  valueOffset: number;
  valueLength: number;
}
const recorded = (name: string): { fileMeta: Recorded[]; dataSet: Recorded[] } =>
  JSON.parse(readFileSync(join(FIXTURES, 'go-dicom', `${name}.json`), 'utf8')) as {
    fileMeta: Recorded[];
    dataSet: Recorded[];
  };

const clean = (s: UiState): void => {
  assert.deepEqual(s.violations, [], 'no CSP violations');
  assert.deepEqual(s.errors, [], 'no uncaught errors in the webview');
};

const settled = (s: UiState): boolean =>
  (s.tagRows > 0 || s.banners.length > 0) && imageSettled(s) && s.hexPendingBytes === 0;

/** Opens a file and makes sure the hex pane is shown (it is opt-in by default). */
async function open(uri: vscode.Uri): Promise<UiState> {
  await openInInspector(uri);
  const s = await waitForUi(uri, settled);
  if (s.panes[2]) return s;
  await ui(uri, { kind: 'togglePane', name: 'bytes' });
  return waitForUi(uri, (x) => settled(x) && x.hexRows > 0);
}

suite('Acceptance', function () {
  this.timeout(120000);
  const scratch = mkdtempSync(join(tmpdir(), 'dt-accept-'));

  suiteSetup(async () => {
    await vscode.workspace
      .getConfiguration('dicomTrace')
      .update('goDicomPath', GO_DICOM, vscode.ConfigurationTarget.Global);
  });

  suiteTeardown(async () => {
    await vscode.workspace
      .getConfiguration('dicomTrace')
      .update('goDicomPath', undefined, vscode.ConfigurationTarget.Global);
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  teardown(closeAll);

  suite('DICOM', function () {
    suiteSetup(function () {
      if (!GO_DICOM) this.skip();
    });

    test('A1: the image renders, meta and data set are distinct, Rows highlights its exact bytes', async () => {
      const uri = dicomUri('MR_small');
      const s = await open(uri);
      clean(s);
      assert.ok(
        s.title.includes('MR Image') && s.title.includes('Explicit VR Little Endian'),
        s.title.join(' | '),
      );
      assert.ok(s.tagSections.some((t) => t.startsWith('File Meta Information')));
      // The data set is grouped by module, in reading order, Pixel Data last.
      const groups = s.tagSections.map((t) => t.replace(/ \(\d+\)$/, ''));
      assert.deepEqual(groups.slice(1, 4), ['Patient', 'Study', 'Series'], groups.join(' | '));
      assert.equal(groups.at(-1), 'Pixel Data');
      const fileOrder = await ui(uri, { kind: 'toggleGrouping' });
      assert.ok(fileOrder.tagSections.some((t) => t.startsWith('Data Set, in file order')));
      await ui(uri, { kind: 'toggleGrouping' });
      assert.ok(s.image && s.image.litFraction > 0.1, JSON.stringify(s.image));

      const rows = await ui(uri, { kind: 'select', id: 'd/(0028,0010)' });
      const tagOffset = recorded('MR_small').dataSet.find(
        (e) => e.tag === '(0028,0010)',
      )!.tagOffset;
      assert.ok(rows.status.includes('(0028,0010) Rows'), rows.status);
      assert.ok(
        rows.status.includes(`0x${tagOffset.toString(16).toUpperCase().padStart(8, '0')}`),
        rows.status,
      );
      // Explicit VR US: tag 4 + VR 2 + length 2 + value 2 bytes.
      assert.equal(rows.hexSelectedBytes, 10);
      assert.equal(rows.hexTagBytes, 4);

      const columns = recorded('MR_small').dataSet.find((e) => e.tag === '(0028,0011)')!;
      const back = await ui(uri, { kind: 'clickByte', offset: columns.valueOffset });
      assert.ok(back.selectedRow.includes('Columns'), back.selectedRow);
    });

    test('A2: implicit VR has no VR bytes; a deflated data set never highlights', async () => {
      const implicit = dicomUri('MR_small_implicit');
      clean(await open(implicit));
      const rows = await ui(implicit, { kind: 'select', id: 'd/(0028,0010)' });
      // Implicit VR: tag 4 + length 4 + value 2 bytes, and no VR field.
      assert.equal(rows.hexSelectedBytes, 10);
      assert.ok(rows.hexNote.includes('vr: not in the file'), rows.hexNote);
      await closeAll();

      const deflated = dicomUri('image_dfl');
      const s = await open(deflated);
      clean(s);
      assert.ok(
        s.banners.some((b) => b.startsWith('Deflated data set')),
        s.banners.join(' | '),
      );
      const first = recorded('image_dfl').dataSet[0]!.tag;
      const inside = await ui(deflated, { kind: 'select', id: `d/${first}` });
      assert.equal(inside.hexSelectedBytes, 0, 'no highlight for a deflated range');
      assert.ok(inside.hexNote.includes('deflated data set'), inside.hexNote);
      const meta = await ui(deflated, { kind: 'select', id: 'm/(0002,0010)' });
      assert.ok(meta.hexSelectedBytes > 0, 'file meta stays physical');
    });

    test('A2: nested and undefined-length elements are found by item path', async () => {
      const uri = dicomUri('nested_priv_SQ');
      clean(await open(uri));
      const s = await ui(uri, { kind: 'select', id: 'd/(0001,0001)[0]/(0001,0001)' });
      assert.ok(s.selectedRow.includes('(0001,0001)'), s.selectedRow);
      assert.ok(s.hexSelectedBytes > 0);
    });

    test('A3: RLE renders; a decode failure stays in the image pane', async () => {
      const rle = dicomUri('MR_small_RLE');
      const s = await open(rle);
      clean(s);
      assert.ok(s.image && s.image.litFraction > 0.1, JSON.stringify(s.image));
      await closeAll();

      const bytes = readFileSync(rle.fsPath);
      const bits = recorded('MR_small_RLE').dataSet.find((e) => e.tag === '(0028,0100)')!;
      bytes.writeUInt16LE(12, bits.valueOffset);
      const broken = join(scratch, 'broken_rle.dcm');
      writeFileSync(broken, bytes);
      const failed = await open(vscode.Uri.file(broken));
      assert.ok(failed.imageNote.includes('could not be decoded'), failed.imageNote);
      assert.ok(failed.tagRows > 50, 'tags still shown');
      assert.ok(failed.hexRows > 0, 'bytes still shown');
      assert.deepEqual(failed.violations, []);
    });

    test('A4: a truncated file keeps its intact tags; an unparseable file keeps its bytes', async () => {
      const truncated = await open(dicomUri('MR_truncated'));
      assert.ok(
        truncated.banners.some((b) => b.startsWith('Partial')),
        truncated.banners.join(' | '),
      );
      assert.ok(truncated.tagRows > 50);
      await closeAll();

      const junk = join(scratch, 'not_dicom.dcm');
      writeFileSync(junk, Buffer.from(Array.from({ length: 2000 }, (_, i) => (i * 37) % 256)));
      const s = await open(vscode.Uri.file(junk));
      assert.ok(
        s.banners.some((b) => b.startsWith('Could not parse')),
        s.banners.join(' | '),
      );
      assert.ok(s.hexRows > 0 && s.hexPendingBytes === 0, 'raw bytes are shown');
      assert.ok(s.imageNote.length > 0, 'the image pane explains itself');
      await closeAll();

      const noTs = await open(dicomUri('meta_missing_tsyntax'));
      assert.ok(
        noTs.banners.some((b) => b.includes('Transfer Syntax UID')),
        noTs.banners.join(' | '),
      );
    });

    test('A5: a change on disk reloads metadata and bytes (revision)', async () => {
      const copy = join(scratch, 'changing.dcm');
      copyFileSync(dicomUri('MR_small').fsPath, copy);
      const uri = vscode.Uri.file(copy);
      const before = await open(uri);
      assert.ok(before.title.includes('Explicit VR Little Endian'));
      copyFileSync(dicomUri('MR_small_RLE').fsPath, copy);
      const after = await waitForUi(
        uri,
        (s) => s.title.includes('RLE Lossless') && imageSettled(s),
      );
      assert.ok(after.title.includes('RLE Lossless'), after.title.join(' | '));
      clean(after);
    });

    test('A5: new pixels on disk show as new pixels, not a cached image', async () => {
      // Same size and syntax, different pixels: only the image can tell the revisions apart.
      const copy = join(scratch, 'repainted.dcm');
      copyFileSync(dicomUri('MR_small').fsPath, copy);
      const uri = vscode.Uri.file(copy);
      await openInInspector(uri);
      const before = await waitForUi(uri, (s) => imageSettled(s) && s.image !== null);
      const pixelData = recorded('MR_small').dataSet.find((e) => e.tag === '(7FE0,0010)');
      assert.ok(pixelData, 'Pixel Data recorded');
      // Invert the Pixel Data value only; the trailing padding element must stay intact.
      const bytes = readFileSync(copy);
      const end = pixelData.valueOffset + pixelData.valueLength;
      for (let i = pixelData.valueOffset; i < end; i++) bytes[i] = 255 - (bytes[i] ?? 0);
      writeFileSync(copy, bytes);
      const after = await waitForUi(
        uri,
        (s) =>
          imageSettled(s) &&
          s.imageNote === '' &&
          s.image !== null &&
          s.image.hash !== before.image?.hash,
      );
      assert.notEqual(after.image?.hash, before.image?.hash, 'the repainted pixels are shown');
      assert.equal(after.imageNote, '', after.imageNote);
      clean(after);
    });

    test('Objects without pixels say what they are; PDF bytes are reachable', async () => {
      for (const [name, sop] of [
        ['synthetic_encapsulated_pdf', 'Encapsulated PDF'],
        ['rtstruct', 'RT Structure Set'],
        ['sr_document', 'Comprehensive 3D SR'],
        ['synthetic_gsps', 'Grayscale Softcopy Presentation State'],
        ['ExplVR_LitEndNoMeta', 'RT Ion Plan'],
      ] as const) {
        const uri = dicomUri(name);
        const s = await open(uri);
        clean(s);
        assert.ok(s.imageNote.includes(sop), `${name}: ${s.imageNote}`);
        await closeAll();
      }
      const pdf = dicomUri('synthetic_encapsulated_pdf');
      await open(pdf);
      const doc = await ui(pdf, { kind: 'select', id: 'd/(0042,0011)' });
      assert.ok(doc.hexSelectedBytes > 0);
    });

    test('SEG masks and overlay planes are drawn', async () => {
      const seg = await open(dicomUri('seg_image_ct_binary'));
      clean(seg);
      assert.ok(seg.image && seg.image.litFraction > 0, JSON.stringify(seg.image));
      assert.ok(seg.imageInfo.includes('frame 2/3'), seg.imageInfo);
      await closeAll();

      const uri = dicomUri('examples_overlay');
      await openInInspector(uri);
      const ov = await waitForUi(uri, (x) => imageSettled(x) && (x.overlay?.opaque ?? 0) > 0);
      clean(ov);
      assert.ok(ov.overlayButtonVisible);
      assert.ok((ov.overlay?.opaque ?? 0) > 0, JSON.stringify(ov.overlay));
    });

    for (const name of [
      'MR_small',
      'MR_small_bigendian',
      'MR_small_implicit',
      'MR_small_RLE',
      'SC_rgb_jpeg_dcmtk',
      'rtdose',
      'emri_small',
      'emri_small_RLE',
      'eCT_Supplemental',
      'examples_overlay',
      'image_dfl',
    ]) {
      test(`renders ${name}`, async () => {
        const uri = dicomUri(name);
        const s = await open(uri);
        clean(s);
        assert.equal(s.imageNote, '', `${name}: ${s.imageNote}`);
        assert.ok(
          s.image && s.image.litFraction > 0.02 && s.image.distinct > 2,
          `${name}: ${JSON.stringify(s.image)}`,
        );
      });
    }

    test('Enhanced multi-frame objects render as stacks', async () => {
      const mr = await open(dicomUri('emri_small'));
      clean(mr);
      assert.ok(mr.image && mr.image.litFraction > 0.1);
      assert.ok(mr.imageInfo.includes('frame 1/10'), mr.imageInfo);
      await closeAll();
      const ct = await open(dicomUri('eCT_Supplemental'));
      clean(ct);
      assert.ok(ct.image && ct.image.litFraction > 0.05);
      assert.ok(ct.imageInfo.includes('frame 1/2'), ct.imageInfo);
    });
  });

  suite('Layout', () => {
    test('panes can be hidden, the choice is remembered, and one always stays', async () => {
      const first = niftiUri('anatomical.nii');
      const start = await open(first);
      assert.deepEqual(start.panes, [true, true, true]);
      const hidden = await ui(first, { kind: 'togglePane', name: 'bytes' });
      assert.deepEqual(hidden.panes, [true, true, false]);
      await ui(first, { kind: 'togglePane', name: 'image' });
      const last = await ui(first, { kind: 'togglePane', name: 'tags' });
      assert.deepEqual(last.panes, [false, true, false], 'the last visible pane cannot be hidden');
      await ui(first, { kind: 'togglePane', name: 'image' });
      await closeAll();

      const next = niftiUri('example_nifti2.nii');
      await openInInspector(next);
      const reopened = await waitForUi(next, settled);
      assert.deepEqual(reopened.panes, [true, true, false], 'remembered for the next file');
      const selected = await ui(next, { kind: 'select', id: 'n/dim' });
      assert.ok(
        selected.status.includes('bytes 0x'),
        'offsets still shown with the hex pane hidden',
      );
      const restored = await ui(next, { kind: 'togglePane', name: 'bytes' });
      assert.deepEqual(restored.panes, [true, true, true]);
      clean(restored);
    });
  });

  suite('Image alone', () => {
    for (const uri of [dicomUri('MR_small'), niftiUri('anatomical.nii')]) {
      test(`the image stays when it is the only pane: ${uri.path.split('/').pop() ?? ''}`, async function () {
        if (uri.path.endsWith('.dcm') && !GO_DICOM) this.skip();
        await openInInspector(uri);
        const start = await waitForUi(uri, (s) => imageSettled(s) && s.image !== null);
        // The layout is remembered across files: start from Image + Tags, then hide Tags.
        if (!start.panes[1]) await ui(uri, { kind: 'togglePane', name: 'tags' });
        if (start.panes[2]) await ui(uri, { kind: 'togglePane', name: 'bytes' });
        const wide = await waitForUi(uri, (s) => s.image !== null && s.image.litFraction > 0.05);
        const alone = await ui(uri, { kind: 'togglePane', name: 'tags' });
        assert.deepEqual(alone.panes, [true, false, false]);
        const drawn = await waitForUi(
          uri,
          (s) =>
            s.image !== null &&
            s.image.litFraction > 0.05 &&
            s.image.width > (start.image?.width ?? 0),
        ).catch(() => ui(uri));
        assert.ok(drawn.image, 'an image canvas is present');
        assert.ok(
          drawn.image.litFraction > 0.05,
          `the image is drawn: ${JSON.stringify(drawn.image)}`,
        );
        assert.ok(
          drawn.image.width > (wide.image?.width ?? 0),
          `and fills the wider pane: ${wide.image?.width ?? 0} → ${drawn.image.width}`,
        );
        // Back to all panes: the image is still there.
        await ui(uri, { kind: 'togglePane', name: 'tags' });
        const back = await waitForUi(
          uri,
          (s) => s.image !== null && s.image.litFraction > 0.05,
        ).catch(() => ui(uri));
        assert.ok(
          back.image && back.image.litFraction > 0.05,
          `drawn again: ${JSON.stringify(back.image)}`,
        );
        clean(back);
      });
    }
  });

  suite('NIfTI', () => {
    for (const [file, version] of [
      ['anatomical.nii', 1],
      ['example4d.nii.gz', 1],
      ['example_nifti2.nii', 2],
      ['example_nifti2.nii.gz', 2],
      ['standard.nii.gz', 1],
    ] as const) {
      test(`${file}: header, bytes and slices`, async () => {
        const uri = niftiUri(file);
        const s = await open(uri);
        clean(s);
        assert.ok(
          s.title.some((t) => t.startsWith(`NIfTI-${version}`)),
          s.title.join(' | '),
        );
        assert.ok(s.image && s.image.litFraction > 0, JSON.stringify(s.image));
        assert.ok(s.imageInfo.includes('slice'), s.imageInfo);
        const dim = await ui(uri, { kind: 'select', id: 'n/dim' });
        if (file.endsWith('.gz')) {
          assert.ok(s.banners.some((b) => b.startsWith('Compressed')));
          assert.equal(dim.hexSelectedBytes, 0, 'no highlight inside a compressed stream');
          assert.ok(dim.hexNote.includes('compressed'), dim.hexNote);
        } else {
          // dim is int16[8] (16 bytes) in NIfTI-1 and int64[8] (64 bytes) in NIfTI-2.
          assert.equal(dim.hexSelectedBytes, version === 1 ? 16 : 64);
        }
      });
    }
  });
});
