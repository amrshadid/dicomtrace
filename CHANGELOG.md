# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-15

The first pilot pre-release.

### Added

- **A read-only editor for DICOM and NIfTI files** (`.dcm`, `.dicom`, `.nii`, `.nii.gz`),
  which opens them by default, since VS Code can't show them as text. **Reopen Editor
  With…** switches to another editor.
- **Three linked panes.** Select a tag and its bytes are highlighted; click a byte and its
  element is selected.
  - **Image:** a toolbar shared by DICOM and NIfTI (left-drag mode Contrast, Pan or Zoom;
    zoom in and out; exact window width and level; Auto; Reset), and for stacks a frame
    slider with Play to watch the frames as a loop. DICOM images
    (explicit and implicit VR, little and big endian, deflated, RLE, JPEG Baseline,
    multi-frame and Enhanced) are rendered with Cornerstone3D; NIfTI slices and 1-bit
    segmentation masks with a built-in renderer that responds the same way. Overlay planes
    can be toggled. Objects without pixels (PDF, RT Structure Set, SR, Presentation State)
    say what they are.
  - **Tags:** File Meta, then the data set grouped by module (Patient, Study, Series and so
    on) or in file order, with sequences and items, VRs, value previews, and search by tag
    number, keyword or name. NIfTI shows every header field.
  - **Bytes:** the file as stored, paged, with physical offsets and separate highlights for
    the tag, VR, length, value and delimiter.
- **Show or hide panes** with the Image, Tags and Bytes buttons; the choice is remembered.
  The Bytes pane is off by default.
- **Honest offsets:** a range is either a verified physical file range or "unavailable" with
  the reason (deflated or compressed data, undefined length without a delimiter, no VR in
  implicit VR).
- **Useful when broken:** truncated files keep their intact tags, unparseable files keep
  their raw bytes (and still get an image attempt), decode failures stay in the image pane,
  and changes on disk reload everything.
- DICOM is parsed by [go-dicom](https://github.com/amrshadid/go-dicom) 1.9.1 or later,
  set with `dicomTrace.goDicomPath` or found on `PATH`.
- Private by default: no network, no telemetry, a strict Content Security Policy, and no tag
  values, paths or bytes in logs.

[Unreleased]: https://github.com/amrshadid/dicomtrace/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/amrshadid/dicomtrace/releases/tag/v0.1.0
