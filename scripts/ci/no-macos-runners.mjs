#!/usr/bin/env node
// Owner rule: GitHub Actions in this repo must never start a macOS / iOS build — macOS minutes
// cost 10x and once burned the whole Actions budget. iOS is built only locally on the Mac.
// Fails (exit 1) if any workflow file uses a macOS runner or an Apple build tool.
//   node scripts/ci/no-macos-runners.mjs [workflowsDir]
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || path.join(process.cwd(), '.github', 'workflows');
const RULES = [
  [/runs-on:.*macos/i, 'macOS runner'],
  [/runs-on:.*\$\{\{(?!\s*matrix\.os\s*\}\})/i, 'dynamic runs-on (could resolve to macOS)'],
  [/\bmacos-(latest|\d+)\b|\b(os|runner|label):\s*['"]?macos/i, 'macOS runner label / matrix entry'],
  [/\bxcodebuild\b|\bxcrun\b|setup-xcode|xcode-version/i, 'Xcode step'],
  [/\bfastlane\b/i, 'fastlane'],
  [/apple-actions\/|testflight|altool|notarytool/i, 'Apple upload/signing action'],
];

const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)) : [];
const hits = [];
for (const f of files) {
  fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (line.trim().startsWith('#')) return;
    for (const [re, what] of RULES) if (re.test(line)) hits.push(`${f}:${i + 1}: ${what}: ${line.trim()}`);
  });
}
console.log(`checked ${files.length} workflow file(s) in ${dir}`);
if (hits.length) {
  console.error(`FAIL: macOS/iOS CI is forbidden (iOS builds run only locally on the Mac):\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log('PASS: no macOS runners or Apple build steps');
