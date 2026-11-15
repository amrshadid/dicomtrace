# Contributing to DicomTrace

Thanks for helping. The scope is narrow on purpose. The first question for any change
is: _does it help someone get from a value (a DICOM tag or a NIfTI header field) to its
bytes, or back?_ Read [docs/design-principles.md](docs/design-principles.md) and
[docs/architecture.md](docs/architecture.md) first.

## Getting started

Requirements: Node.js 22 or later (see `.nvmrc`), git, VS Code, and the
[go-dicom](https://github.com/amrshadid/go-dicom) executable (1.9.1 or later) for the
parser-backed tests.

```sh
npm ci
npm run check   # lint, formatting, type check, unit and golden tests
```

Press **F5** in VS Code to launch an **Extension Development Host**. It runs in a
separate window with a temporary profile (`--profile-temp`) and the fixture folder, which
has DICOM files in `dicom/` and NIfTI files in `nifti/`. Set
`dicomTrace.goDicomPath` in that window if go-dicom isn't on your `PATH`, then
click a file to open it in the inspector.

| Script                      | Purpose                                                    |
| --------------------------- | ---------------------------------------------------------- |
| `npm run build`             | Bundle the extension, webview and decode worker to `dist/` |
| `npm run build:prod`        | Minified build; fails if a bundle is over its size budget  |
| `npm run watch`             | Rebuild on change                                          |
| `npm test`                  | Unit and golden tests (Vitest)                             |
| `npm run test:coverage`     | The same, with coverage thresholds on `src/core`           |
| `npm run test:integration`  | End-to-end tests in a downloaded, isolated VS Code         |
| `npm run fixtures:go-dicom` | Re-record go-dicom output for the fixtures (pass its path) |
| `npm run lint`              | ESLint (strict, type-aware, with layer boundaries)         |
| `npm run format`            | Prettier                                                   |
| `npm run package`           | Build a `.vsix`                                            |

Set `GO_DICOM_PATH=/absolute/path/to/go-dicom` to run the tests that need the parser: the
≥ 200 MB file test (`npm test`) and the DICOM end-to-end tests (`npm run
test:integration`). Without it they are skipped.

CI also runs `npm audit --omit=dev` (no known advisories in anything that ships) and the
production build, whose size budgets are set in `esbuild.mjs`.

The end-to-end tests read and drive the real webview through test hooks
(`src/webview/testHooks.ts`) that exist only when the test runner sets `DT_TEST_HOOKS=1`.

### Fixtures and recordings

Test files must be public or synthetic, with their source and licence recorded in
[test/fixtures/README.md](test/fixtures/README.md). Three scripts regenerate what the
tests compare against:

| Script                                          | What it writes                                                  |
| ----------------------------------------------- | --------------------------------------------------------------- |
| `npm run fixtures:go-dicom -- <go-dicom>`       | `test/fixtures/go-dicom/*.json`, go-dicom's output per fixture  |
| `python3 -I scripts/record-nibabel-headers.py`  | `test/fixtures/nifti/nibabel/*.json`, nibabel's reading         |
| `python3 -I scripts/make-synthetic-fixtures.py` | The synthetic PDF and presentation state fixtures (pydicom 2.4) |

## Where code goes

- `src/core/`: pure TypeScript with no `vscode`, no Node I/O and no DOM. The offset
  contract, parser-output normalisation, paging and search live here, with full tests.
  ESLint and a separate tsconfig enforce the boundary.
- `src/protocol/`: message types and validators shared by the host and the webview.
- `src/adapters/`: thin VS Code and Node glue, with no business rules.
- `src/webview/`: the browser bundle. UI state only; it never parses DICOM itself.
- `src/extension.ts`: wiring.

## Standards

- TypeScript `strict` and `exactOptionalPropertyTypes`. No `any`; use `unknown` and narrow it.
- **Honest offsets.** Never highlight a byte range the parser has not established as a
  physical file range. Show "unavailable" with a reason instead.
- New logic ships with tests. A bug fix starts with a failing test. Every reported
  range is checked against the real fixture bytes by the golden tests.
- No new runtime dependencies without a recorded decision.
- No telemetry, no network access, no writing source files, and no tag values, paths
  or raw bytes in logs. These are product promises.
- **Fixtures must be public or synthetic.** Never commit patient data. Record each
  file's source and licence in `test/fixtures/README.md`.

## Commits and pull requests

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
fix(hex): clip highlights to the visible page

A value spanning two pages was highlighted on the first page only.
```

- Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`.
- Scopes: `core`, `protocol`, `parser`, `editor`, `webview`, `image`, `tags`, `hex`, `config`, `ci`, `docs`, `deps`.
- Keep the subject imperative and under 72 characters. Use the body to explain _why_.
- One logical change per commit. Pull requests are squash-merged, so the PR title must also follow the convention.

## Reporting bugs

Open an issue using the bug template, with a **de-identified** file if one is needed.
For security issues, see [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
