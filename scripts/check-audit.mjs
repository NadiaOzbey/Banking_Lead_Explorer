import { readFileSync } from 'node:fs';

const advisory = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const findings = report.vulnerabilities;
const result = Number(process.argv[3]);
if (report.error || !findings || ![0, 1].includes(result)) {
  throw new Error('npm audit did not produce a usable report');
}

function isKnownFinding(name, path = new Set()) {
  const finding = findings[name];
  if (!finding?.via?.length || path.has(name)) return false;
  const next = new Set([...path, name]);
  return finding.via.every((cause) =>
    typeof cause === 'string' ? isKnownFinding(cause, next)
      : name === 'picomatch' && cause.url === advisory
  );
}

const blocking = Object.keys(findings).filter((name) =>
  ['moderate', 'high', 'critical'].includes(findings[name].severity)
);
if (result === 0 && blocking.length === 0) {
  console.log('Full dependency audit passed.');
} else if (result === 1 && blocking.length && blocking.every((name) => isKnownFinding(name))) {
  console.log('::warning::Temporary development dependency exception for GHSA-fc5q-39xc-vjpf (picomatch).');
} else {
  console.error('The full dependency audit reported findings outside the exception.');
  process.exitCode = 1;
}
