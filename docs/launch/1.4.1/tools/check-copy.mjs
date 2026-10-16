#!/usr/bin/env node
// Deterministic copy gate for the Whisperio iOS 1.4.1 launch docs (docs/launch/1.4.1/**/*.md).
// Adapted from the Zryw launch gate (draenger/zryw docs/launch/1.1/tools/check-copy.mjs), with the lessons
// from its review: rules run on the WHOLE file (tables, FAQ, prose), exemptions are per rule and per block.
//
//   node docs/launch/1.4.1/tools/check-copy.mjs [dir]       exit 1 on any FAIL. Offline, read-only, Node >= 18.
//   node docs/launch/1.4.1/tools/check-copy.mjs --self-test  every planted defect must be caught (and nothing else)
//
// The upper bound for any privacy claim is docs/privacy.html.
//
// Rules (whole file, every line):
//   privacy      absolute privacy / compliance claims that privacy.html does not support.
//   license      "open source" / "OSS" / "FOSS": Whisperio is source-available (PolyForm Noncommercial).
//   competitors  competitor names (no bashing; answer about Whisperio's model instead).
//   providers    Anthropic / Claude: the iOS app has no Anthropic client.          NEVER exemptable.
//   promises     "free forever", ranking superlatives.                              NEVER exemptable.
//   placeholders leftover TODO / FIXME / TBD / XXX / lorem / [[...]]. {{PLACEHOLDERS}} (incl. Polish
//                capitals) are listed as INFO, not failed.
//   limits       a line `<!-- limit:N -->` (or `limit:N words`) right before a fence caps that fence.
//
// Quoting a banned phrase on purpose (guidance like: never write `100% private`):
//   * in prose, put it in an inline code span `like this`: code spans are quotations and are not checked;
//   * a fenced block may be exempted from ONE exemptable rule by a line `<!-- allow: <rule> -->` directly
//     above the fence (above or below a limit line). Inline markers and bare `<!-- allow -->` exempt nothing.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES = {
  privacy: [
    /100\s?%\s*(private|offline|secure|local|prywatn\w*)/i, /(completely|fully|totally|absolutely|perfectly) private/i,
    /nothing (ever )?leaves your (device|phone|mac|iphone)/i, /never leaves your (device|phone|mac|iphone)/i,
    /end[- ]to[- ]end/i, /\bE2EE?\b/, /HIPAA/i, /(GDPR|RODO)[- ](compliant|certified|zgodn\w*)/i, /compliant with (GDPR|HIPAA)/i,
    /zgodn\w* z (RODO|GDPR)/i, /no data (is )?(ever )?collected/i, /(we|it) collects? no data/i, /zero data/i, /military[- ]grade/i,
    /unhackable/i, /całkowicie prywatn\w*/i, /w pełni prywatn\w*/i, /nic nie opuszcza/i, /nigdy nie opuszcza/i, /szyfrowani\w* end/i,
    /\be2ee?\b/i, /compliant with (the )?(GDPR|HIPAA)/i, /100 ?percent (private|offline|secure)/i, /never leaves (the|this) (device|phone|iphone|ipad|mac)/i,
    /nothing (ever )?leaves (your|the|this) (device|phone|iphone|ipad|mac)/i, /never (uploaded|sent anywhere)/i,
  ],
  license: [/open[- ]?source/i, /\bOSS\b/, /\bFOSS\b/, /otwart\w* ?(kod|źródł)/i, /otwartoźródłow\w*/i],
  // not validated for regulated transcription
  regulated: [/medical (transcri|dictat|record)\w*/i, /legal (transcri|dictat)\w*/i, /clinical/i, /\bHIPAA\b/i, /transkrypc\w* (medyczn|prawn|sądow)\w*/i, /dyktowani\w* (medyczn|prawn)\w*/i],
  competitors: [/wispr/i, /superwhisper/i, /macwhisper/i, /\bdragon\b/i, /otter\.?ai/i, /\bdictato\b/i, /\baqua ?voice\b/i, /voiceink/i],
  providers: [/\bAnthropic\b/i, /\bClaude\b/],
  promises: [/free forever/i, /forever free/i, /za darmo na zawsze/i, /na zawsze za darmo/i, /\bna zawsze\b/i, /always free/i, /free for life/i, /lifetime/i, /dożywotni\w*/i, /bezterminow\w*/i, /world'?s first/i, /pierwsz\w* na świecie/i, /\bbest\b/i, /(?<![#\w])#\s?1\b(?!\.)/, /\bno\.? ?1\b/i,
    /number one/i, /najlepsz\w*/i, /\b(fastest|most accurate|most private)\b/i, /najszybsz\w*/i, /\bthe only\b/i, /jedyn\w* (taka|aplikacj)/i],
};
const EXEMPTABLE = new Set(['privacy', 'license', 'competitors']);
const LEFTOVER = /\bTODO\b|\bFIXME\b|\bTBD\b|\bXXX\b|[Ll]orem ipsum|\[\[[^\]]*\]\]/;
const PLACEHOLDER = /\{\{([\p{Lu}0-9_ ]+)\}\}/gu;

function parse(lines) {
  // fences with the annotation lines directly above them (limit / allow, any order, no blank lines between)
  const blocks = [];
  const inFence = new Array(lines.length).fill(null);
  for (let i = 0, open = null; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) {
      if (!open) {
        const ann = [];
        for (let j = i - 1; j >= 0 && ANNOTATION.test(lines[j]); j--) ann.push(lines[j]);
        const lim = ann.map((a) => a.match(/<!--\s*limit:(\d+)(\s+words)?\s*-->/)).find(Boolean);
        const allow = new Set(ann.map((a) => a.match(/^\s*<!--\s*allow:\s*([a-z-]+)\s*-->\s*$/)).filter(Boolean).map((m) => m[1]).filter((r) => EXEMPTABLE.has(r)));
        open = { start: i + 1, body: [], limit: lim ? +lim[1] : null, words: !!(lim && lim[2]), allow };
      } else { blocks.push(open); open = null; }
    } else if (open) { open.body.push(lines[i]); inFence[i] = open; }
  }
  // an unclosed fence would silently swallow the rest of the file (and extend its allow:)
  const unclosed = blocks.length * 2 !== lines.filter((l) => /^\s*```/.test(l)).length;
  return { blocks, inFence, unclosed };
}

const norm = (t) => t.normalize('NFKC').replace(/[\u2010\u2011\u2012\u2013\u2212]/g, '-').replace(/[\u00a0\u202f\u2007\u2009]/g, ' ');
// only the two annotation forms are skipped; any other comment line is checked like copy (no hiding copy in comments)
const ANNOTATION = /^\s*<!--\s*(limit:\d+(\s+words)?|allow:\s*[a-z-]+)\s*-->\s*$/;

function checkText(rel, text, out, placeholders) {
  const lines = norm(text).split(/\r?\n/);
  const { blocks, inFence, unclosed } = parse(lines);
  out(!unclosed, rel, 'fences', unclosed ? 'unclosed ``` fence' : 'all fences closed');
  for (const rule of Object.keys(RULES)) {
    const hits = [];
    lines.forEach((raw, i) => {
      if (/^\s*```/.test(raw) || ANNOTATION.test(raw)) return;
      const b = inFence[i];
      if (b && b.allow.has(rule)) return;
      const l = b ? raw : raw.replace(/`[^`]*`/g, ''); // prose: inline code spans are quotations
      for (const re of RULES[rule]) { const m = l.match(re); if (m) hits.push(`${i + 1}:"${m[0]}"`); }
    });
    out(!hits.length, rel, rule, hits.length ? hits.join(', ') : 'clean');
  }
  lines.forEach((l) => { for (const m of l.matchAll(PLACEHOLDER)) placeholders.add(m[1]); });
  const left = lines.map((l, i) => (LEFTOVER.test(l) ? i + 1 : 0)).filter(Boolean);
  out(!left.length, rel, 'placeholders', left.length ? 'TODO/FIXME/TBD/XXX/lorem/[[..]] at lines ' + left.join(',') : 'none left over');
  const limited = blocks.filter((b) => b.limit != null);
  const over = limited.map((b) => {
    const t = b.body.join('\n').trim();
    const n = b.words ? t.split(/\s+/).filter(Boolean).length : [...t].length;
    return n > b.limit ? `line ${b.start}: ${n}/${b.limit}${b.words ? ' words' : ' chars'}` : null;
  }).filter(Boolean);
  out(!over.length, rel, 'limits', over.length ? over.join('; ') : `${limited.length} limited blocks within limits`);
}

if (process.argv.includes('--self-test')) {
  const fence = (s, ...ann) => `${ann.map((a) => a + '\n').join('')}\`\`\`\n${s}\n\`\`\`\n`;
  const CASES = [
    // positive: must pass clean
    ['clean copy passes', fence('Free dictation for iPhone. On-device by default, or bring your own API key. We run no server.'), null],
    ['prose may quote banned phrases in code spans', 'Never write `100% private`, `open source` or `free forever`.\n', null],
    ['allow line above fence exempts its rule', fence('Q: Is it open source? A: No, source-available.', '<!-- allow: license -->'), null],
    ['allow + limit lines in any order', fence('Not open source.', '<!-- limit:100 -->', '<!-- allow: license -->'), null],
    ['Polish placeholder is INFO, not a fail', 'Data: {{DATA_PREMIERY}} {{ŁĄCZE}}\n', null],
    // negative: must be caught by the named rule
    ['100% private (fence)', fence('Whisperio is 100% private.'), 'privacy'],
    ['nothing leaves (table row)', '| Pitch | Nothing ever leaves your iPhone. |\n', 'privacy'],
    ['end-to-end (FAQ prose)', 'A: Yes, it is end-to-end encrypted.\n', 'privacy'],
    ['GDPR compliant', fence('GDPR-compliant by design.'), 'privacy'],
    ['PL zgodna z RODO', fence('Aplikacja zgodna z RODO.'), 'privacy'],
    ['no data collected', fence('No data collected, ever.'), 'privacy'],
    ['PL całkowicie prywatna', 'Całkowicie prywatna aplikacja.\n', 'privacy'],
    ['open source in prose (no code span)', 'Whisperio is open source.\n', 'license'],
    ['PL otwarty kod', fence('Aplikacja na otwartym kodzie źródłowym.'), 'license'],
    ['inline allow marker exempts nothing', fence('It is open source. <!-- allow: license -->'), 'license'],
    ['bare allow exempts nothing', fence('It is open source.', '<!-- allow -->'), 'license'],
    ['allow for another rule does not exempt', fence('It is open source.', '<!-- allow: privacy -->'), 'license'],
    ['Anthropic cannot be exempted', fence('Use OpenAI or Anthropic.', '<!-- allow: providers -->'), 'providers'],
    ['free forever cannot be exempted', fence('Free forever.', '<!-- allow: promises -->'), 'promises'],
    ['markdown heading "## 1." is not "#1"', '## 1. Where\n', null],
    ['#1 claim', fence('The #1 dictation app.'), 'promises'],
    ['superlative in table', '| Tagline | The best dictation app |\n', 'promises'],
    ['competitor', fence('Like Wispr Flow, but free.'), 'competitors'],
    ['leftover TODO', 'TODO: write this\n', 'placeholders'],
    ['leftover FIXME', 'FIXME later\n', 'placeholders'],
    ['leftover [[...]]', 'Contact: [[KONTAKT]]\n', 'placeholders'],
    ['over limit', fence('x'.repeat(301), '<!-- limit:300 -->'), 'limits'],
    ['over word limit', fence('a b c d e f', '<!-- limit:5 words -->'), 'limits'],
    // adversarial strings from the Opus review (all passed the first version)
    ['non-breaking hyphen open\u2011source', fence('Whisperio is open\u2011source.'), 'license'],
    ['PL otwartoźródłowa', fence('Aplikacja otwartoźródłowa.'), 'license'],
    ['copy hidden between comments', '<!-- note --> Whisperio is 100% private <!-- end -->\n', 'privacy'],
    ['medical transcription', fence('Great for medical transcription.'), 'regulated'],
    ['PL transkrypcja medyczna', fence('Idealne do transkrypcji medycznej.'), 'regulated'],
    ['always free', fence('Always free.'), 'promises'], ['free for life', fence('Free for life.'), 'promises'],
    ['PL darmowa na zawsze', fence('Darmowa na zawsze.'), 'promises'],
    ['never leaves the device', fence('Audio never leaves the device.'), 'privacy'],
    ['nothing leaves your iPad', fence('Nothing leaves your iPad.'), 'privacy'],
    ['lowercase e2e', fence('Sync is e2e encrypted.'), 'privacy'],
    ['compliant with the GDPR', fence('Fully compliant with the GDPR.'), 'privacy'],
    ['100 percent private', fence('100 percent private.'), 'privacy'],
    ["world's first", fence("The world's first BYOK dictation app."), 'promises'],
    ['unclosed fence', '<!-- allow: license -->\n```\nOpen source.\n', 'fences'],
  ];
  let bad = 0;
  for (const [name, text, rule] of CASES) {
    const res = [];
    checkText('fixture', text, (ok, f, r) => res.push({ ok, r }), new Set());
    const fails = res.filter((x) => !x.ok).map((x) => x.r);
    const ok = rule == null ? fails.length === 0 : fails.length > 0 && fails.every((r) => r === rule);
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'MISS'} ${name}${rule ? ' -> ' + rule : ''}${ok ? '' : ' (got: ' + (fails.join(',') || 'nothing') + ')'}`);
  }
  const ph = new Set();
  checkText('fixture', 'x {{DATA_PREMIERY}} {{ŁĄCZE}}', () => {}, ph);
  const phOk = ph.has('ŁĄCZE') && ph.has('DATA_PREMIERY');
  if (!phOk) bad++;
  console.log(`${phOk ? 'ok  ' : 'MISS'} Polish capitals collected as placeholders`);
  console.log(bad ? `SELF-TEST: FAIL (${bad}/${CASES.length + 1})` : `SELF-TEST: PASS (${CASES.length + 1} cases)`);
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
