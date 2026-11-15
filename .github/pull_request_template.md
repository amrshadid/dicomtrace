## What and why

<!-- What does this change, and which problem does it solve? Link the issue. -->

## How it was tested

<!-- Unit tests, golden offset tests, integration tests, manual steps. -->

## Checklist

- [ ] The PR title follows Conventional Commits (`type(scope): summary`)
- [ ] `npm run check` passes
- [ ] `npm run test:integration` passes
- [ ] Offset and parsing rules live in `src/core` and have unit or golden tests
- [ ] No highlight is shown for a range the parser did not establish as physical
- [ ] No tag values, file paths or raw bytes are logged
- [ ] New fixtures are public or synthetic and listed in `test/fixtures/README.md`
- [ ] Docs and CHANGELOG are updated if user-facing behaviour changed
