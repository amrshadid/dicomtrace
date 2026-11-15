# Design principles

DicomTrace follows **HCD (Human-Centred Design)**: the developer, their task and
their trust come before features. Our user is an imaging developer debugging a file that one
tool reads and another rejects.

Use these principles to judge features, defaults and pull requests. If a change doesn't help
someone get from a value to its bytes, or back, it's out of scope.

## 1. One place, not three tools

The core task is "from this decoded value to its bytes, and back". The image, the tags and
the bytes live in one editor tab and stay linked both ways: select a tag and its bytes light
up; click a byte and its tag is selected. We measure the tool in clicks and context
switches saved.

## 2. Honest offsets

A highlighted range is a claim about the file. We make it only when it is a verified
physical range in the version of the file on disk. Otherwise the range is **unavailable**,
with the reason in words: a deflated data set, a compressed `.nii.gz`, undefined length with
no delimiter, no VR in implicit VR, or anything that doesn't check out against the file
size. Unavailable is hatched and named, never highlighted. A wrong highlight is worse than
no highlight.

## 3. Useful when broken

Developers open this tool _because_ a file is broken, so failure is the main use case. The
image, the tags and the bytes are independent: a decode failure keeps the tags and bytes, a
parse failure keeps the raw bytes, and a truncated file keeps the elements before the cut,
with a banner that says so.

## 4. Private by default

DICOM files can carry patient information. Everything stays local: no network, no telemetry,
no remote scripts, a strict Content Security Policy, nothing about your files in logs, and
source files are never written. See [SECURITY.md](../SECURITY.md).

## 5. Bounded work

Multi-hundred-megabyte files must not freeze the editor. The parser leaves bulk data in the
file, the hex view reads one 64 KiB page at a time, very large images aren't sent to the
image pane, and closing the tab cancels the work.

## 6. Respect the developer's setup

It opens DICOM and NIfTI files by default, because VS Code can't show them as text, and you
can switch to any other editor with **Reopen Editor With…**. It follows the VS Code theme,
including high contrast, keeps a quiet UI, and lets you hide the panes you don't need. The
hex pane is off until you ask for it.

## 7. Evaluate with real people

Every feature has to earn its place in the pilot: do developers find the tag and its bytes
without leaving the tool, and do they trust what it shows? We'd rather do one thing reliably
than many things loosely.
