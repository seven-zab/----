const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

// Inspect tracked paths only. Ignored local files must remain available locally.
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const developmentRoots = [
  'server/',
  'contracts/',
  'database/',
  'tests/',
  'scripts/',
  'docs/',
  'src/',
  'cloudfunctions/',
];
const newFiles = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(
    (file) =>
      developmentRoots.some((root) => file.startsWith(root)) || file === 'tsconfig.server.json',
  );
const files = [...new Set([...tracked, ...newFiles])];
const forbidden = files.filter((file) => {
  const segments = file.split('/');
  const name = segments[segments.length - 1];
  return (
    segments.some((segment) =>
      ['node_modules', 'dist', 'unpackage', 'coverage', '.baseline'].includes(segment),
    ) ||
    (name.startsWith('.env') && !name.endsWith('.example')) ||
    name === 'project.private.config.json' ||
    file.endsWith('.log') ||
    (!file.includes('/') && file.endsWith('.zip'))
  );
});

const credentialPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['model API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/],
];
let credentialCount = 0;
for (const file of files) {
  if (
    !/\.(?:[cm]?js|ts|vue|json|md|yml|yaml|example)$/.test(file) ||
    !fs.existsSync(file) ||
    fs.statSync(file).size > 2_000_000
  ) {
    continue;
  }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    for (const [label, pattern] of credentialPatterns) {
      if (pattern.test(lines[index])) {
        // Never echo the matching value into build logs.
        console.error(`${file}:${index + 1}: possible ${label} (value redacted)`);
        credentialCount++;
      }
    }
  }
}

for (const file of forbidden) {
  console.error(`Generated/local-only file tracked by Git: ${file}`);
}
if (forbidden.length || credentialCount) {
  process.exitCode = 1;
} else {
  console.log(`Repository hygiene passed: ${files.length} tracked/development files checked.`);
  console.log('Credential detection is heuristic, not a complete security audit.');
}
