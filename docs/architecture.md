# Architecture

DicomTrace uses a **functional core with an imperative shell, in two runtimes**.
The extension host (Node) parses files and reads bytes; the webview (a browser sandbox) draws
the three panes. They talk only through a typed, validated message protocol. The risky logic
(is this range really in the file? which element encloses this byte? what can this object
show?) is pure TypeScript with no VS Code, no file system and no DOM, so it can be tested
against real file bytes.

```
src/
├── core/                 Pure logic: no `vscode`, no Node I/O, no DOM (ESLint and tsconfig enforce this)
│   ├── ranges.ts         The offset contract: a range is physical, or unavailable with a reason
│   ├── inspection.ts     The model the panes show: elements, item paths, ranges, previews
│   ├── goDicom.ts        go-dicom `show --json` → Inspection; version check
│   ├── objectInfo.ts     What the image pane can do: Cornerstone, 1-bit, or "no image"
│   ├── nifti.ts          NIfTI-1 and NIfTI-2 header parser, every field with its bytes
│   ├── niftiModel.ts     NIfTI header → display model (physical or "compressed")
│   ├── niftiVoxels.ts    NIfTI slice decoding (datatypes, byte order, scaling)
│   ├── windowLevel.ts    Window/level dragging, the same as Cornerstone's tool
│   ├── locate.ts         Byte → the deepest element that encloses it
│   ├── search.ts         Tag search by number, keyword or name
│   ├── hexPaging.ts      Page and row arithmetic for the hex view
│   ├── logFormat.ts      Log lines that can't carry file data
│   └── webviewHtml.ts    The webview page and its Content Security Policy
├── protocol/
│   └── messages.ts       Host ↔ webview messages and their validators
├── adapters/             Host-side I/O, no rules
│   ├── editorProvider.ts The read-only custom editor: load, cancel, route messages
│   ├── inspectorDocument.ts  One open file: revision, file watcher, positional reads
│   ├── goDicomRunner.ts  Runs go-dicom safely: absolute path, no shell, timeout, cancel
│   ├── configuration.ts  The go-dicom path setting, trust-aware
│   └── log.ts            The output channel
├── webview/              Browser bundle: UI state only, never parses DICOM structure
│   ├── main.ts           Layout, message routing, linking the panes
│   ├── tagsPane.ts       The tag tree and search
│   ├── hexPane.ts        The paged hex view and its highlights
│   ├── imagePane.ts      Chooses the renderer; failures stay here
│   ├── cornerstoneView.ts  DICOM images with Cornerstone3D (lazy-loaded)
│   ├── rasterView.ts     Our canvas renderer: NIfTI slices and 1-bit masks
│   └── decodeWorker.ts   Cornerstone's decode worker, bundled for a blob URL
└── extension.ts          Composition root: wiring and registration
```

Dependencies point inward: `extension.ts → adapters → core`, and `webview → protocol + core`.
The webview never imports host code, and the core imports neither.

## The life of a file

```
Click a .dcm / .dicom / .nii / .nii.gz file
  host  1. InspectorDocument: stat the file, revision 0, watch it for changes
        2. DICOM: go-dicom show --json (checked version, no shell, timeout, cancellable)
           NIfTI: read the file; inflate .nii.gz with a size cap; parse the header
        3. core: normalise into an Inspection or a NIfTI view; every range checked
  ──►   4. post "opened" (the model, never the path) and "imageData" to the webview
  view  5. tags pane shows the tree; image pane picks a renderer
        6. you select a tag → the hex pane asks for the pages it shows
  ◄──   7. "readBytes" {document, revision, offset, length ≤ 64 KiB}
  host  8. validate the shape, the document, the revision and the bounds; read positionally
  ──►   9. "bytes" → the hex pane highlights tag, VR, length and value separately
```

If the file changes on disk, the watcher moves the revision on, the host parses again, and
anything stamped with the old revision is dropped on both sides. A pane never shows bytes
from one version of the file next to tags from another.

## The offset contract

Every range the panes might highlight is one of two things:

- **physical**: zero-based, half-open file offsets, checked against the file size; or
- **unavailable**, with a reason: `deflated`, `compressed`, `undefinedLengthNoDelimiter`,
  `notEncoded` (no VR in implicit VR) or `parseError`.

The type makes every pane handle both cases. The core decides which applies, in one place:
a deflated data set or a `.nii.gz` makes every affected range unavailable, an undefined
length ends at the delimiter the parser reports or is unavailable, and anything that fails
the bounds check is unavailable rather than wrong. Elements are identified by their item
path, such as `d/(0008,1115)[1]/(0008,1150)`, so repeated tags in different items stay
distinct.

## Images

The image pipeline is independent of the tags and the bytes: whatever happens in the image
pane stays there.

- **DICOM** goes to Cornerstone3D, lazily loaded. Webviews only allow single-file blob
  workers, so Cornerstone's decode worker is its own bundle, fetched and started from a Blob
  URL and registered before the loader starts. Zoom (right drag) and frame scrolling (wheel)
  are our own small handlers, because Cornerstone's tools misbehave in a webview in those two
  cases. Decode errors are caught by racing the load against Cornerstone's error events and a
  timeout. Overlay planes (60xx) are drawn on a canvas layer that follows zoom and pan.
- **NIfTI and 1-bit DICOM** (segmentation masks) go to our own canvas renderer. The core
  decodes one slice at a time; the renderer applies window/level with the same response as
  Cornerstone's tool. NIfTI slices are shown in voxel order and labelled as such.
- **Objects without pixels** (PDF, RT Structure Set, SR, Presentation State) get a plain
  sentence saying what the object is. Cornerstone isn't called.

## Why these choices

- **An external parser.** Byte-accurate DICOM parsing with offsets is the hardest part, and
  [go-dicom](https://github.com/amrshadid/go-dicom) already reports exact offsets for every
  element, item, fragment and delimiter. Running it as a process keeps the extension small
  and lets the parser be tested on its own.
- **Our own NIfTI parser.** NIfTI headers are fixed layouts, so a small table-driven parser
  gives every field an exact range, in both byte orders, and is checked field by field
  against nibabel.
- **Two runtimes, one protocol.** The webview is a sandbox; the host can read files. Keeping
  them apart, with every webview message validated, mirrors the real security boundary.
- **The model, never raw parser output.** The webview receives only the checked model, with
  bounded value previews, and never a file path.
- **Panes that can fail alone.** A file that won't decode still has tags and bytes; a file
  that won't parse still has bytes.

## Testing

| Layer          | Tool                               | What                                                                                                                                                               |
| -------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Core, protocol | Vitest                             | Table-driven and hostile inputs for every module. Coverage thresholds ≥ 90% lines.                                                                                 |
| Golden: DICOM  | Vitest + real fixture bytes        | Every go-dicom offset, and every range our model highlights, checked against the bytes of every fixture.                                                           |
| Golden: NIfTI  | Vitest + nibabel recordings        | Every header field and sample voxels compared with nibabel's reading.                                                                                              |
| Large files    | Vitest + real go-dicom             | A generated 200 MB file must give metadata-sized output with correct offsets.                                                                                      |
| End to end     | `@vscode/test-cli` in real VS Code | Opens each fixture in the real editor and checks what the panes show, including highlights, links, failures, layout and the absence of security-policy violations. |

The fixtures are public test files and a few synthetic ones, listed with their sources and
licences in [test/fixtures/README.md](../test/fixtures/README.md).
