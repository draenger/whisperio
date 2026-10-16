#!/usr/bin/env node
// Deterministic copy gate for the Whisperio iOS 1.4.1 launch docs (docs/launch/1.4.1/**/*.md).
// Adapted from the Zryw launch gate (draenger/zryw docs/launch/1.1/tools/check-copy.mjs).
//
//   node docs/launch/1.4.1/tools/check-copy.mjs [dir]   exit 1 on any FAIL. Offline, read-only, Node >= 18.
//   node docs/launch/1.4.1/tools/check-copy.mjs --self-test   every planted defect must be caught
//
// Fenced code blocks are the copy meant to be pasted (posts, comments, taglines). Prose around them is
// guidance and may NAME a banned phrase ("never say 100% private"), so most rules only look inside fences.
// The upper bound for any privacy claim is docs/privacy.html.
//
// Checks, per file:
//   privacy      absolute privacy / compliance claims that privacy.html does not support (in fences).
//   license      "open source" / "OSS" / "FOSS": Whisperio is source-available (PolyForm Noncommercial).
//   providers    Anthropic / Claude named in mobile copy (the iOS app has no Anthropic client).
//   promises     "free forever", ranking superlatives (in fences).
//   competitors  no competitor names in fences (no bashing; comparisons belong in answers to direct questions).
//   placeholders leftover TODO / TBD / XXX / lorem anywhere. Intentional {{PLACEHOLDERS}} are INFO only.
//   limits       a line `<!-- limit:N -->` (or `limit:N words`) right before a fence caps that fence.
// A fenced line that must quote a banned phrase on purpose carries `<!-- allow: <rule> -->` naming the ONE
// rule it is exempt from (a bare allow exempts nothing).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES = {
  privacy: [
    /100\s?%\s*(private|offline|secure|local)/i, /(completely|fully|totally|absolutely|perfectly) private/i,
    /nothing (ever )?leaves your (device|phone|mac|iphone)/i, /never leaves your (device|phone|mac|iphone)/i,
    /end[- ]to[- ]end/i, /\bE2EE?\b/, /HIPAA/i, /(GDPR|RODO)[- ](compliant|certified|zgodn\w*)/i, /compliant with (GDPR|HIPAA)/i,
    /no data (is )?(ever )?collected/i, /(we|it) collects? no data/i, /zero data/i, /military[- ]grade/i, /unhackable/i,
    /w 100\s?% prywatn\w*/i, /całkowicie prywatn\w*/i, /nic nie opuszcza/i, /nigdy nie opuszcza/i, /szyfrowani\w* end/i,
  ],
  license: [/open[- ]?source/i, /\bOSS\b/, /\bFOSS\b/, /otwart\w* (kod|źródł)/i, /open[- ]?source'?ow\w*/i],
  providers: [/\bAnthropic\b/i, /\bClaude\b/],
  promises: [/free forever/i, /forever free/i, /za darmo na zawsze/i, /na zawsze za darmo/i, /\bbest\b/i, /#\s?1\b/, /\bno\.? ?1\b/i,
    /number one/i, /najlepsz\w*/i, /\b(fastest|most accurate|most private)\b/i, /najszybsz\w*/i, /\bthe only\b/i, /jedyn\w* (taka|aplikacj)/i],
  competitors: [/wispr/i, /superwhisper/i, /macwhisper/i, /\bdragon\b/i, /otter\.?ai/i, /\bdictato\b/i, /\baqua ?voice\b/i, /voiceink/i],
};
const LEFTOVER = /\bTODO\b|\bTBD\b|\bXXX\b|[Ll]orem ipsum/;

function blocksOf(lines) {
  const blocks = [];
  for (let i = 0, open = null; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) {
      if (!open) {
        let j = i - 1; while (j >= 0 && !lines[j].trim()) j--;
        const m = j >= 0 && lines[j].match(/<!--\s*limit:(\d+)(\s+words)?\s*-->/);
        open = { start: i + 1, body: [], limit: m ? +m[1] : null, words: !!(m && m[2]) };
      } else { blocks.push(open); open = null; }
    } else if (open) open.body.push(lines[i]);
  }
  return blocks;
}

function checkText(rel, text, out, placeholders) {
  const lines = text.split(/\r?\n/);
  const blocks = blocksOf(lines);
  const fenced = blocks.flatMap((b) => b.body.map((l, k) => [l, b.start + k + 1]));
  for (const rule of ['privacy', 'license', 'providers', 'promises', 'competitors']) {
    const hits = fenced
      .filter(([l]) => !new RegExp(`<!--\\s*allow:\\s*${rule}\\s*-->`).test(l))
      .flatMap(([l, n]) => RULES[rule].map((re) => l.match(re)).filter(Boolean).map((m) => `${n}:"${m[0]}"`));
    out(!hits.length, rel, rule, hits.length ? hits.join(', ') : 'clean');
  }
  lines.forEach((l) => { for (const m of l.matchAll(/\{\{([A-Z0-9_ ]+)\}\}/g)) placeholders.add(m[1]); });
  const left = lines.map((l, i) => (LEFTOVER.test(l) ? i + 1 : 0)).filter(Boolean);
  out(!left.length, rel, 'placeholders', left.length ? 'TODO/TBD/XXX/lorem at lines ' + left.join(',') : 'none left over');
  const limited = blocks.filter((b) => b.limit != null);
  const over = limited.map((b) => {
    const t = b.body.join('\n').trim();
    const n = b.words ? t.split(/\s+/).filter(Boolean).length : [...t].length;
    return n > b.limit ? `line ${b.start}: ${n}/${b.limit}${b.words ? ' words' : ' chars'}` : null;
  }).filter(Boolean);
  out(!over.length, rel, 'limits', over.length ? over.join('; ') : `${limited.length} limited blocks within limits`);
}

if (process.argv.includes('--self-test')) {
  const fence = (s, lim) => `${lim ? `<!-- limit:${lim} -->\n` : ''}\`\`\`\n${s}\n\`\`\`\n`;
  const CASES = [
    ['clean copy passes', fence('Free dictation for iPhone. On-device by default, or bring your own API key. We run no server.'), null],
    ['100% private', fence('Whisperio is 100% private.'), 'privacy'],
    ['nothing leaves', fence('Nothing ever leaves your iPhone.'), 'privacy'],
    ['end-to-end', fence('End-to-end encrypted dictation.'), 'privacy'],
    ['GDPR compliant', fence('GDPR-compliant by design.'), 'privacy'],
    ['no data collected', fence('No data collected, ever.'), 'privacy'],
    ['PL całkowicie prywatna', fence('Całkowicie prywatna aplikacja.'), 'privacy'],
    ['open source', fence('An open-source dictation app.'), 'license'],
    ['PL otwarty kod', fence('Aplikacja na otwartym kodzie źródłowym.'), 'license'],
    ['Anthropic on mobile', fence('Use OpenAI, Anthropic or Groq.'), 'providers'],
    ['free forever', fence('Free forever.'), 'promises'],
    ['superlative', fence('The best dictation app for Mac.'), 'promises'],
    ['competitor', fence('Like Wispr Flow, but free.'), 'competitors'],
    ['leftover TODO', 'TODO: write this\n', 'placeholders'],
    ['over limit', fence('x'.repeat(301), 300), 'limits'],
    ['allow names its rule', fence('Q: Is it open source? <!-- allow: license -->'), null],
    ['bare allow exempts nothing', fence('It is open source. <!-- allow -->'), 'license'],
    ['prose may name banned phrases', 'Never write "100% private" or "open source".\n', null],
  ];
  let bad = 0;
  for (const [name, text, rule] of CASES) {
    const res = [];
    checkText('fixture', text, (ok, f, r) => res.push({ ok, r }), new Set());
    const fails = res.filter((x) => !x.ok).map((x) => x.r);
    const ok = rule == null ? fails.length === 0 : fails.includes(rule);
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'MISS'} ${name}${rule ? ' -> ' + rule : ''}${ok ? '' : ' (got: ' + (fails.join(',') || 'nothing') + ')'}`);
  }
  console.log(bad ? `SELF-TEST: FAIL (${bad}/${CASES.length})` : `SELF-TEST: PASS (${CASES.length} cases)`);
  process.exit(bad ? 1 : 0);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || join(here, '..'));
const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') && files.push(p); } };
walk(root);
let fails = 0;
const placeholders = new Set();
const out = (ok, file, check, msg) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${file} ${check}: ${msg}`); };
for (const f of files.sort()) checkText(relative(root, f).replace(/\\/g, '/'), readFileSync(f, 'utf8'), out, placeholders);
console.log(`INFO files: ${files.length}; placeholders to fill before publishing: ${[...placeholders].sort().map((p) => '{{' + p + '}}').join(' ') || 'none'}`);
console.log(fails ? `RESULT: FAIL (${fails})` : 'RESULT: PASS');
process.exit(fails ? 1 : 0);
