#!/usr/bin/env node
// Deterministic checker: values/strings.xml (EN) vs values-pl/strings.xml (PL).
// Fails (exit 1) on: missing PL keys, placeholder mismatch, unescaped apostrophes,
// missing/invalid plural quantities in PL. No dependencies.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'src', 'main', 'res');
const read = (d) => readFileSync(join(root, d, 'strings.xml'), 'utf8');

// Returns Map key -> array of texts (string => [text]; plurals => ["quantity:text", ...]).
function parse(xml) {
  const out = new Map();
  const noComments = xml.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of noComments.matchAll(/<string\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g)) {
    out.set(m[1], [{ q: '', t: m[2] }]);
  }
  for (const m of noComments.matchAll(/<plurals\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/plurals>/g)) {
    const items = [...m[2].matchAll(/<item\s+quantity="([^"]+)"[^>]*>([\s\S]*?)<\/item>/g)]
      .map((i) => ({ q: i[1], t: i[2] }));
    out.set(m[1], items);
  }
  return out;
}

const placeholders = (t) =>
  [...t.matchAll(/%(?:\d+\$)?[-#+ 0,(]*\d*(?:\.\d+)?[a-zA-Z]/g)].map((x) => x[0]).sort().join(' ');
const unescapedApostrophe = (t) => /(^|[^\\])'/.test(t);

const en = parse(read('values'));
const pl = parse(read('values-pl'));
const errors = [];

for (const [key, enItems] of en) {
  const plItems = pl.get(key);
  if (!plItems) { errors.push(`missing PL key: ${key}`); continue; }
  const enPh = new Set(enItems.map((i) => placeholders(i.t)));
  for (const it of plItems) {
    const ph = placeholders(it.t);
    // every EN variant uses the same set of placeholders; PL must match one of them
    if (!enPh.has(ph)) errors.push(`placeholder mismatch in ${key}${it.q ? '[' + it.q + ']' : ''}: PL "${ph}" vs EN "${[...enPh].join(' | ')}"`);
  }
  if (enItems[0].q) {
    const qs = new Set(plItems.map((i) => i.q));
    for (const need of ['one', 'few', 'many', 'other']) {
      if (!qs.has(need)) errors.push(`plural ${key}: PL missing quantity "${need}"`);
    }
  }
}
for (const key of pl.keys()) if (!en.has(key)) errors.push(`PL key not in EN: ${key}`);
for (const [key, items] of pl) {
  for (const it of items) {
    if (unescapedApostrophe(it.t)) errors.push(`unescaped apostrophe in ${key}${it.q ? '[' + it.q + ']' : ''}`);
  }
}

if (errors.length) {
  console.log(errors.map((e) => '  - ' + e).join('\n'));
  console.log(`FAIL (${errors.length} problem${errors.length === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log(`PASS (${en.size} keys checked)`);
