# Test fixtures

Only public, de-identified or synthetic files belong here. **Never commit real
patient data.** Each file is listed below with its source and licence. A new fixture
must be added to this table in the same commit.

## `dicom/`: pydicom test files

The twelve files below come unmodified from pydicom's `src/pydicom/data/test_files/` at tag
**v3.0.2**, commit
[`20aa4b73aef76bffb6fbc46a8827588dfa9bb89d`](https://github.com/pydicom/pydicom/tree/20aa4b73aef76bffb6fbc46a8827588dfa9bb89d/src/pydicom/data/test_files).
Each was downloaded from

```
https://raw.githubusercontent.com/pydicom/pydicom/20aa4b73aef76bffb6fbc46a8827588dfa9bb89d/src/pydicom/data/test_files/<name>
```

| File | Why it is here | Transfer syntax | Bytes | Origin (from pydicom's `test_files/README.txt`) |
| --- | --- | --- | --- | --- |
| `MR_small.dcm` | Main fixture: explicit VR LE, 64×64 MONOCHROME2 | 1.2.840.10008.1.2.1 | 9830 | Downsized from NEMA WG04 `MR1_UNC` |
| `MR_small_implicit.dcm` | Implicit VR LE (no VR field) | 1.2.840.10008.1.2 | 9702 | `MR_small` saved with implicit VR using dcmodify |
| `MR_small_bigendian.dcm` | Explicit VR BE | 1.2.840.10008.1.2.2 | 9708 | `MR_small` saved as big endian using dcmodify |
| `test-SR.dcm` | Nesting to depth 5, repeated tags | 1.2.840.10008.1.2.1 | 6796 | DCMTK dscope `srdoc103.zip`, file `test.dcm` |
| `nested_priv_SQ.dcm` | Undefined-length sequence and items with delimiters | 1.2.840.10008.1.2 | 343 | Listed only as implicit VR LE; minimal data set from a pydicom issue |
| `image_dfl.dcm` | Deflated data set: its ranges must be "unavailable" | 1.2.840.10008.1.2.1.99 | 4637 | `image_dfl` from dclunie.com compressed images |
| `MR_small_RLE.dcm` | First compressed syntax (RLE Lossless) | 1.2.840.10008.1.2.5 | 7790 | RLE version of `MR_small` (pydicom: "RLE encoded versions created using GDCM's gdcmconv for PR #708") |
| `SC_rgb_jpeg_dcmtk.dcm` | JPEG Baseline: second compressed syntax, decode-failure case | 1.2.840.10008.1.2.4.50 | 3424 | pydicom `SC_rgb*` series |
| `MR_truncated.dcm` | Truncated file: partial tags plus a banner | 1.2.840.10008.1.2.1 | 9630 | `MR_small`, cut short (not individually listed) |
| `rtdose.dcm` | Multi-frame (15 frames) | 1.2.840.10008.1.2 | 7568 | "Created by a commercial radiotherapy treatment planning system and modified" |
| `meta_missing_tsyntax.dcm` | Malformed file meta: no transfer syntax | (none) | 317 | pydicom (not individually listed) |
| `ExplVR_LitEndNoMeta.dcm` | Bare data set, no preamble or file meta (out of scope; for "unsupported" messaging) | inferred explicit VR LE | 434 | Listed only as explicit VR LE |

The full SHA-256 of every file is in [`dicom/SHA256SUMS`](dicom/SHA256SUMS); check
with `shasum -a 256 -c SHA256SUMS` from that folder.

## `dicom/`: Enhanced multi-frame files (pydicom-data)

Enhanced IODs keep per-frame data in functional-group sequences. pydicom stores these
larger files in [pydicom/pydicom-data](https://github.com/pydicom/pydicom-data) (MIT
licence, "Copyright (c) 2020 Dicom in Python"). pydicom v3.0.2 (commit `20aa4b73…`)
pins each one in `src/pydicom/data/urls.json` to pydicom-data commit
`39a2eb31815eec435dc26c322c27aec5cfcbddb6`, with its SHA-256 in `hashes.json`. We
downloaded from those pinned URLs, and each file matches pydicom's recorded hash.

```
https://github.com/pydicom/pydicom-data/raw/39a2eb31815eec435dc26c322c27aec5cfcbddb6/data/<name>
```

| File | Why it is here | Transfer syntax | Bytes | Origin |
| --- | --- | --- | --- | --- |
| `eCT_Supplemental.dcm` | Enhanced CT with shared and per-frame functional groups (nested item paths), 2 frames, 512×512 | 1.2.840.10008.1.2.1 | 1052902 | pydicom's `test_files/README.txt`: original filename CT0012, from NEMA's public multi-frame CT samples (`ftp://medical.nema.org/medical/dicom/Multiframe/CT/nemamfct.images.tar.bz2`) |
| `emri_small.dcm` | Enhanced MR SOP class, 10 frames, 64×64. **No functional groups** (stripped in this small version) | 1.2.840.10008.1.2.1 | 84256 | Not documented by pydicom or pydicom-data |
| `emri_small_RLE.dcm` | The same Enhanced MR in RLE Lossless (our first compressed syntax) | 1.2.840.10008.1.2.5 | 49022 | Not documented; RLE version of `emri_small.dcm` |

## `dicom/`: non-image and annotation objects

Tags and bytes must work for DICOM objects that are not plain images, and the image
pane must say what it can and cannot show.

| File | What it is | Transfer syntax | Bytes | Source and licence |
| --- | --- | --- | --- | --- |
| `rtstruct.dcm` | RT Structure Set (ROI contours). **No preamble or file meta**: pydicom refuses it without `force=True` | implicit VR LE (bare data set) | 2534 | pydicom v3.0.2 `test_files` (commit `20aa4b73…`), listed but not individually described; same terms as the pydicom files above |
| `examples_overlay.dcm` | MR image with Overlay Data in group 6000 | 1.2.840.10008.1.2.1 | 321700 | pydicom v3.0.2 `test_files`: "MR-SIEMENS-DICOM-WithOverlays.dcm with cropped Pixel Data and Overlay Data"; the original is from GDCM (BSD-3-Clause, notice below) |
| `seg_image_ct_binary.dcm` | Segmentation (SEG), BINARY, 3 frames, 1-bit | 1.2.840.10008.1.2 | 4380 | [highdicom](https://github.com/ImagingDataCommons/highdicom) `data/test_files` at commit `a04ad77b41beb2b14566b199f71e5d55985e07ec`, MIT. Its README: derived from pydicom's small CT series using highdicom |
| `sr_document.dcm` | Comprehensive 3D SR (TID 1500 measurements of a CT image) | 1.2.840.10008.1.2.1 | 5004 | highdicom, same commit and licence. Its README: "A simple SR document following TID 1500 describing measurements of a CT image" |
| `synthetic_encapsulated_pdf.dcm` | Encapsulated PDF Storage; a 597-byte hand-written PDF in (0042,0011) | 1.2.840.10008.1.2.1 | 1520 | **Synthetic**, made by this project with `scripts/make-synthetic-fixtures.py` (pydicom 2.4.5, reproducible). MIT, like the project |
| `synthetic_gsps.dcm` | Grayscale Softcopy Presentation State annotating `MR_small.dcm`: text, an ROI polyline, a VOI window | 1.2.840.10008.1.2.1 | 1850 | **Synthetic**, same script and terms |

URLs:

```
https://raw.githubusercontent.com/pydicom/pydicom/20aa4b73aef76bffb6fbc46a8827588dfa9bb89d/src/pydicom/data/test_files/<name>
https://raw.githubusercontent.com/ImagingDataCommons/highdicom/a04ad77b41beb2b14566b199f71e5d55985e07ec/data/test_files/<name>
```

GDCM notice (for `examples_overlay.dcm`): Copyright (c) 2006-2016 Mathieu Malaterre,
Copyright (c) 1993-2005 CREATIS. Redistribution and use in source and binary forms, with
or without modification, are permitted under the BSD 3-Clause licence; see
<https://github.com/malaterre/GDCM/blob/master/Copyright.txt>.

### Licence

pydicom's code is MIT-licensed. Its `LICENSE` covers the package "except for portions
outlined below", and the test data files carry **no explicit licence** of their own.
pydicom's `test_files/README.txt` records where each file came from and says:

> I obtained images to test the pydicom code, and revised them as follow:
>
> - images were often downsized to keep the total file size quite small (typically
>   <50K-ish). I wanted unittests for the code where I could run a number of tests
>   quickly, and with files I could include in the source (and binary) distributions
>   without bloating them too much
> - In some cases, the original files have been binary edited to replace anything
>   that looks like a real patient name
>
> I believe there is no restriction on using any of these files in this manner.

We use them the same way, as small unit and integration test inputs, and keep this
attribution with them. We deliberately avoid files with stricter or unclear terms
(dcm4che under MPL 1.1, TCIA-derived data, gdcmData).

### Not committed

The large-file test (≥ 200 MB) generates its input at test time from
`MR_small.dcm` by growing Pixel Data with non-zero bytes. It is never committed.

## `nifti/`: NIfTI files (nibabel)

From [nibabel](https://github.com/nipy/nibabel) `nibabel/tests/data` at commit
`67e3b24fa8ab0c4d6bebca03d42486b1f2201eda`. nibabel's `COPYING`: "The nibabel package,
including all examples, code snippets and attached documentation is covered by the MIT
license" (Copyright (c) 2009-2019 Matthew Brett and others); these files are not in its
list of third-party data.

```
https://raw.githubusercontent.com/nipy/nibabel/67e3b24fa8ab0c4d6bebca03d42486b1f2201eda/nibabel/tests/data/<name>
```

| File | Why it is here | Bytes |
| --- | --- | --- |
| `anatomical.nii` | NIfTI-1, single file, **big-endian**, 3D int16 (33×41×25) | 68002 |
| `example4d.nii.gz` | NIfTI-1, gzip, 4D (128×96×24×2) | 346451 |
| `example_nifti2.nii.gz` | NIfTI-2, gzip, 4D (32×20×12×2) | 21160 |
| `example_nifti2.nii` | NIfTI-2, uncompressed: `gunzip -c example_nifti2.nii.gz` (derived by this project) | 31328 |
| `standard.nii.gz` | NIfTI-1, gzip, tiny 3D (4×5×7) | 143 |

`nifti/nibabel/*.json` is nibabel 5.3.2's reading of each **raw** header (not the
post-load header, where nibabel resets scaling and `vox_offset`), recorded with
`python3 -I scripts/record-nibabel-headers.py`. The golden test checks our parser
against it field by field.

## `go-dicom/`: recorded parser output

`go-dicom/<name>.json` is the output of `go-dicom show <name> --json` for each file in
`dicom/`, recorded with the go-dicom version named in `go-dicom/VERSION`. The golden
test checks every offset in these files against the bytes in `dicom/`. Re-record them
with `npm run fixtures:go-dicom -- <path-to-go-dicom>`.

These files are generated by this project from the fixtures above and carry the same
terms.
