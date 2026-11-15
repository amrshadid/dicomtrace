<p align="center"><img src="media/icon.png" width="128" alt="DicomTrace icon"></p>

# DicomTrace

**Open a DICOM or NIfTI file in VS Code and trace any tag from its value to the exact bytes that encode it.**

The image, the tag tree and the bytes sit side by side and stay linked: select a tag and
its bytes light up, click a byte and its tag is selected. Read-only, and nothing leaves
your machine.

> [!NOTE]
> **Pilot pre-release (v0.1.0).** It works, and we're testing it with a few imaging
> developers before a wider release. Feedback is very welcome:
> [open an issue](https://github.com/amrshadid/dicomtrace/issues).

## Install

Download `dicomtrace-0.1.0.vsix` from the
[latest release](https://github.com/amrshadid/dicomtrace/releases), then in VS Code open
the Extensions view, choose **…** → **Install from VSIX…**, and pick the file. DICOM files
also need [go-dicom](https://github.com/amrshadid/go-dicom) 1.9.1 or later (see
[Requirements](#requirements)); NIfTI files work without it.

## Why

A DICOM file is two things at once: an image someone looks at, and a binary encoding a
parser walks byte by byte. When something goes wrong, the bug sits where the two meet. One
library opens the file and another rejects it. The image renders inverted or stretched
because of one attribute. A converter writes a length, VR or transfer syntax that a
downstream tool misreads.

For example, in [pydicom issue #150](https://github.com/pydicom/pydicom/issues/150)
(reported in 2014), files with no preamble or File Meta header, and so no "DICM" marker,
were rejected by pydicom by default. The reporter said the same files were "read without
problem by DicomBrowser or DCMTK's dcmdump".

Finding out why usually takes three tools: a **viewer** to see the symptom, a **dump** to
find the tag, and a **hex editor** to find the bytes, copying offsets between them by hand
and working out implicit or explicit VR, header sizes and nesting in your head. Every step
is a chance to look at the wrong bytes.

DicomTrace puts all three in one editor tab, linked, and is honest about the
bytes it can't point to. More in [docs/why.md](docs/why.md).

## How it works

1. **Click** a `.dcm`, `.dicom`, `.nii` or `.nii.gz` file in the Explorer. It opens in the
   inspector, since VS Code can't show these files as text.
2. Select a tag, or click a byte.

To use another editor for these files, run **Reopen Editor With…** from the editor's `…`
menu or the Command Palette; VS Code can also remember that choice as your default.

| Pane      | What it shows                                                                                                                                                                                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Image** | The rendered image, with window/level, zoom, pan and frames or slices. If the object has no image (a PDF, an RT Structure Set), it says what the object is.                                                                                                                                                                    |
| **Tags**  | File Meta, then the data set grouped by module (Patient, Study, Series, Equipment, Acquisition, Image… with Pixel Data last), or in file order with one click. Sequences, items and nested elements, VRs (marked when they come from the dictionary in implicit VR) and value previews. Search by tag number, keyword or name. |
| **Bytes** | The file as stored, with physical offsets. The selected element's tag, VR, length, value and delimiter are marked separately. Click any byte to select the element it belongs to. Off by default; turn it on with the **Bytes** button.                                                                                        |

The **Image**, **Tags** and **Bytes** buttons in the title bar show or hide each pane, and
your choice is remembered. With the Bytes pane hidden, the status bar still shows the
selected element's exact offsets.

### Image tools

The toolbar under the image header works the same for DICOM and NIfTI:

| Tool                      | What it does                                                             |
| ------------------------- | ------------------------------------------------------------------------ |
| **Contrast / Pan / Zoom** | What a left drag does. Middle drag always pans; right drag always zooms. |
| **−** and **+**           | Zoom out and in.                                                         |
| **W** and **L**           | Type an exact window width (contrast) and level (brightness).            |
| **Auto**                  | Fit the window to the image's minimum and maximum.                       |
| **Reset**                 | Window/level, zoom and pan back to the start.                            |

For images with more than one frame or slice, a bar under the image has a **slider** to
scrub through them and **Play** to watch them as a loop. 4D NIfTI files get a second slider
for the volume. The **wheel** and the arrow keys step one frame or slice; `[` and `]` step
one volume.

In Contrast mode, dragging right widens the window and dragging down raises the level, with
the same sensitivity for DICOM and NIfTI.

Tag search accepts `(0028,0010)`, `0028,0010`, `00280010` or `0x00280010`, and keywords
or names such as `Rows` or `pixel`. Matches inside sequences are found and revealed.

## What you can open

| File                                                                                              | Image                                    | Tags and bytes                                                              |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| DICOM, explicit or implicit VR, little or big endian                                              | Yes                                      | Yes, every range exact                                                      |
| Compressed DICOM: RLE Lossless, JPEG Baseline                                                     | Yes                                      | Yes                                                                         |
| Deflated DICOM                                                                                    | Yes                                      | Values yes; data set byte ranges **unavailable** (the bytes are compressed) |
| Multi-frame and Enhanced DICOM (Enhanced CT, MR)                                                  | Yes, frame by frame                      | Yes, including functional group sequences                                   |
| Segmentations (1-bit) and overlay planes (60xx)                                                   | Yes; overlays can be toggled             | Yes                                                                         |
| Objects without pixels: Encapsulated PDF, RT Structure Set, Structured Report, Presentation State | Says what the object is                  | Yes; an encapsulated document's bytes can be selected                       |
| NIfTI-1 and NIfTI-2, `.nii`                                                                       | Yes, slice by slice and volume by volume | Every header field mapped to its bytes                                      |
| NIfTI, `.nii.gz`                                                                                  | Yes                                      | Values yes; byte ranges **unavailable** (the bytes are compressed)          |

## Honest offsets

A highlighted range is a claim about the file, so the tool makes it only when it holds.
Every range is either a **physical file offset** in the version of the file on disk, or
**unavailable**, with the reason in words:

- **Deflated data set** or **compressed file** (`.nii.gz`): the bytes on disk are
  compressed, so values are shown but no range is highlighted.
- **Undefined length with no delimiter**: the end of the value isn't known.
- **Not in the file**: implicit VR has no VR bytes.
- **Not established by the parser**: anything that doesn't check out against the file size.

Unavailable ranges are hatched and named, never highlighted. Every reported range is tested
against the real bytes of every test file.

## When files are broken

Most people open a tool like this _because_ a file is broken, so a failure in one place
never blanks the others.

- **Truncated file:** the elements before the cut are shown with a "partial" banner, and
  every byte is still in the Bytes pane.
- **Not readable as DICOM:** the banner says so, the raw bytes are still shown, and the
  Image pane still tries to decode the pixels.
- **Image won't decode:** the error appears in the Image pane only. Tags and bytes keep
  working.
- **The file changes on disk:** everything reloads. A pane never shows bytes from one
  version next to tags from another.
- Parser warnings (a missing transfer syntax, a retired tag) appear as banners.

## Requirements

- VS Code 1.100 or later, on a desktop (macOS, Windows or Linux).
- [go-dicom](https://github.com/amrshadid/go-dicom/releases) **1.9.1 or later** for DICOM
  files. Download the binary for your platform, check it against the release's
  `SHA256SUMS`, and put it on your `PATH`, or set `dicomTrace.goDicomPath` to its
  absolute path. NIfTI files don't need it.

If go-dicom is missing or too old, the inspector says so and shows the raw bytes.

## Private and safe by default

DICOM files can contain patient information, so everything stays on your machine:

- **No network and no telemetry.** The editor loads no remote scripts, fonts or images,
  under a strict Content Security Policy with no `eval` and no inline scripts.
- **Read-only.** Files are opened for reading and never written.
- **Nothing about your files in logs.** The output channel records event names, sizes and
  timings only, never tag values, paths or bytes.
- **Untrusted input is checked.** Every request from the editor view is validated before a
  file is read, and it can never name a path. Tag values are shown as text, never as HTML.
- **go-dicom runs safely.** It is started by its absolute path, without a shell, with a
  timeout, and stopped when you close the file. In an untrusted workspace its path is taken
  only from your user settings.

See [SECURITY.md](SECURITY.md) for details and how to report a problem.

## Design principles

DicomTrace follows **HCD (Human-Centred Design)**: the developer, their task and
their trust come before features.

- **One place, not three tools.** From a value to its bytes and back, in one tab.
- **Honest offsets.** A highlight is a claim, made only when it holds.
- **Useful when broken.** Failure is the main use case, not an edge case.
- **Private by default.** Nothing leaves your machine.
- **Bounded work.** Large files are read a page at a time, and closing the tab stops the work.
- **Respect the developer's setup.** It follows your theme, and you can switch editors anytime.

More in [docs/design-principles.md](docs/design-principles.md).

## Settings

| Setting                  | Default | What it does                                                                                                                              |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `dicomTrace.goDicomPath` | `""`    | Absolute path to go-dicom (1.9.1 or later). Empty means look it up on `PATH`. In untrusted workspaces, only the user-level value is used. |

## Limitations

These are deliberate choices for the first release:

- **Local files only.** Remote, WSL, Codespaces and VS Code for the Web aren't supported yet.
- **One file at a time.** No series or study browsing, and no PACS or DICOMweb.
- **Not a clinical viewer.** It is a developer and research tool, not for diagnosis.
- **Read-only.** No editing or anonymisation.
- **Some compressed syntaxes don't render yet:** JPEG 2000, JPEG-LS and HTJ2K. Their tags and
  bytes still work.
- **NIfTI slices are shown in voxel order**, not reoriented to the patient, and complex or
  RGB NIfTI data isn't shown.
- **Images over 512 MB** aren't sent to the Image pane; tags and bytes still work.
- **Values aren't searched**, only tag numbers, keywords and names, because values can be
  patient information.
- **go-dicom is installed separately** for now.

## How it compares

As of November 2026, we found no VS Code or Open VSX extension that links a selected DICOM
tag to its exact byte ranges in the file. Outside VS Code, tools such as
[Sante DICOM Hexadecimal Viewer](https://santesoft.com/win/sante-dicom-viewer-pro/howto/dicom-hex-viewer.html)
(Windows), [ImHex](https://github.com/WerWolv/ImHex) and 010 Editor (with DICOM patterns),
and small web tools such as [dicom-explorer](https://github.com/petermtate/dicom-explorer)
link tags to hex bytes. We found none that combines a rendered image, a searchable tag tree
and a hex view that highlights the tag, VR, length and value as separate ranges inside the
editor.

For NIfTI, extensions such as [NiiVue](https://marketplace.visualstudio.com/items?itemName=KorbinianEckstein.niivue)
already show images and headers; NIfTI support here exists so the same value-to-bytes
workflow works on `.nii` files.

If you know of a tool that does all of this, please open an issue. We'd rather point people
to it.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) to get set up. The
architecture is described in [docs/architecture.md](docs/architecture.md). Please never
attach patient data to an issue: use a de-identified or synthetic file.

## License

[MIT](LICENSE). The test files come from public sources, listed with their licences in
[test/fixtures/README.md](test/fixtures/README.md).
