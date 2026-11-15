// Records `go-dicom show <file> --json` for every fixture in test/fixtures/dicom
// into test/fixtures/go-dicom/, plus the go-dicom version used. The golden test
// checks these recordings against the fixture bytes, so it runs without go-dicom.
//
// usage: npm run fixtures:go-dicom -- /absolute/path/to/go-dicom
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const goDicom = process.argv[2];
if (!goDicom || !isAbsolute(goDicom)) {
  console.error('usage: npm run fixtures:go-dicom -- /absolute/path/to/go-dicom');
  process.exit(2);
}

const fixtures = 'test/fixtures/dicom';
const out = 'test/fixtures/go-dicom';
mkdirSync(out, { recursive: true });

// No shell: arguments go straight to the executable.
const run = (args) =>
  execFileSync(goDicom, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const version = run(['version']).trim();
writeFileSync(join(out, 'VERSION'), `${version}\n`);

for (const name of readdirSync(fixtures)
  .filter((f) => f.endsWith('.dcm'))
  .sort()) {
  const json = run(['show', join(fixtures, name), '--json']);
  // Re-serialise so recordings are stable and diff-friendly across go-dicom releases.
  const doc = JSON.parse(json);
  writeFileSync(join(out, name.replace(/\.dcm$/, '.json')), `${JSON.stringify(doc, null, 2)}\n`);
  console.log(
    `${name}: ${doc.dataSet?.length ?? 0} top-level elements, ${doc.warnings?.length ?? 0} warnings`,
  );
}
console.log(`recorded with ${version}`);
