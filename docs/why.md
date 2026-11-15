# Why DicomTrace exists

## The problem

A DICOM file is two things at once: an image a person looks at, and a binary encoding a
parser walks byte by byte. When something goes wrong, the bug sits where the two meet:

- **One library opens the file and another rejects it.** For example, in
  [pydicom issue #150](https://github.com/pydicom/pydicom/issues/150) (reported in 2014),
  files with no preamble or File Meta header, and so no "DICM" marker, were rejected by
  pydicom by default. The reporter said the same files were "read without problem by
  DicomBrowser or DCMTK's dcmdump".
- **The image renders wrong** (inverted, stretched, garbled) because of one attribute.
- **A converter writes a length, VR or transfer syntax** that a downstream tool misreads.

Finding the cause today takes three tools:

- **A viewer** to see the symptom.
- **A dump** (`dcmdump`, pydicom, `go-dicom show`) to find the tag.
- **A hex editor** to find the bytes.

Moving between them means copying offsets by hand and working out implicit or explicit VR,
header sizes and sequence nesting in your head. Every step is a chance to look at the wrong
bytes and draw the wrong conclusion.

The same is true one level down for NIfTI: the header is a fixed binary layout, and a wrong
`vox_offset`, byte order or scaling field shows up as a wrong image long before anyone looks
at the bytes.

What the developer wants is one place where the image, the decoded tags and the raw bytes
stay linked, and where the tool is honest about the bytes it can't point to.

## What we don't know yet

We have anecdotes, not numbers: one public issue and our own parser work. We don't know how
often developers hit this, so we don't claim it is common. The pilot is how we find out.

## Existing tools

We surveyed the Visual Studio Marketplace and Open VSX in November 2026, read the listings
of every DICOM extension, and for eight of them read their source. Inside VS Code we found
no extension that shows DICOM byte offsets or links a tag to its bytes.

Outside VS Code, the mapping itself is not new, and these tools deserve credit:

- [Sante DICOM Hexadecimal Viewer](https://santesoft.com/win/sante-dicom-viewer-pro/howto/dicom-hex-viewer.html)
  (Windows, proprietary): a tag tree, tag and data offsets, and a hex dump that highlights
  the selected element.
- [ImHex](https://github.com/WerWolv/ImHex) and 010 Editor, with DICOM patterns: fields
  mapped to bytes in a general hex editor.
- [dicom-explorer](https://github.com/petermtate/dicom-explorer) (web): separate tag, VR,
  length and value highlights, and byte-to-tag clicks.

We found none that combines all of these:

- a rendered image, a searchable tag tree and a hex view in one place
- tag, VR, length and value highlighted as separate ranges
- byte-to-tag clicks
- an honest "unavailable" state, with the reason, for bytes that can't be mapped
- inside the editor developers already use, cross-platform and open source

The value we're testing is that combination inside the editor, not the mapping itself. For
NIfTI, extensions such as NiiVue already show images and headers; NIfTI support here exists
so the same value-to-bytes workflow works on `.nii` files. New tools appear often, so we
check again before each release.

## How we'll know if it works

We're running a small pilot with imaging developers, each on a real interop or decoding
problem of their own. DicomTrace is worth continuing if pilot users:

- find the tag and its byte range **without** switching to a separate viewer, dump or hex
  editor, and
- trust what it highlights, including when it says a range is unavailable.

We'll also ask what they still leave the tool for. If the answer is "most things", we'll
narrow the scope or stop. We won't add features to compensate.
