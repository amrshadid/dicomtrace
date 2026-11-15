# Security policy

DICOM files can contain protected health information (PHI). DicomTrace is
built so that nothing leaves your machine:

- **No network.** No requests, no telemetry, no external scripts or fonts. The webview
  runs under a strict Content Security Policy with no `unsafe-eval` and no inline scripts.
- **Read-only.** Files are opened for reading and never written.
- **Nothing sensitive in logs.** The output channel records only event types, sizes,
  durations and error categories, never tag values, file paths or raw bytes.
- **Untrusted messages.** Every message from the webview is validated in the extension
  host (document, revision, bounded offset and length) before any file is read. A
  request can never name a path.
- **External parser.** DICOM files are parsed by the `go-dicom` executable (1.9.1 or
  later, checked before use), launched without a shell by its absolute path, with a
  timeout and an output cap, and stopped when you close the file. In an untrusted
  workspace (Restricted Mode), the executable path is only taken from your user
  settings, never from workspace settings.
- **NIfTI.** NIfTI files are parsed by the extension itself. A `.nii.gz` file is
  inflated with a size cap, so a small compressed file cannot expand without limit.
- **Bounded work.** Bytes are read one page (64 KiB) at a time. Files over 512 MB are
  not sent to the image pane.
- **What is stored.** Only your choice of visible panes, in VS Code's own storage for
  the extension. Nothing about your files is stored.
- **Text, not markup.** Tag values and header fields are shown as text, never as HTML.

Because we log nothing about your files, a bug report needs a **de-identified** or
synthetic file to reproduce. Please never send us patient data.

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository instead (**Security → Report a vulnerability**).

We aim to acknowledge reports within 7 days. Only the latest release is supported with fixes.
