#!/usr/bin/env node
// Deterministic gate for the Whisperio 1.4.1 App Store listing proposal (docs/launch/1.4.1/aso/*.json) plus a
// diff against the listing in the repo today (mobile/marketing/listing/*.json). Offline, read-only, no
// dependencies, Node >= 18 on Windows and macOS. Same shape as Zryw's docs/launch/1.1/tools/check-aso.mjs.
//
//   node docs/launch/1.4.1/tools/check-aso.mjs              # gate + comparison, exit 1 on any FAIL
//   node docs/launch/1.4.1/tools/check-aso.mjs --quiet      # only FAIL lines and the result
//   node docs/launch/1.4.1/tools/check-aso.mjs --self-test  # every planted defect must be caught
//
// Limits come from mobile/marketing/pipeline/asc_listing.py (the uploader). The privacy rules encode the upper
// bound set by docs/privacy.html and docs/notes/2026-10-16-legal.md: no developer server and no analytics are
// true; "nothing ever leaves your device" is not (cloud providers, Apple online recognition, iCloud sync).
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..', '..');
const aso = join(here, '..', 'aso');
const quiet = process.argv.includes('--quiet');
const read = (...p) => readFileSync(join(...p), 'utf8');
const json = (...p) => JSON.parse(read(...p));
const len = (s) => [...(s || '')].length;
const LOCALES = ['en-US', 'pl'];

function ascLimits() {
  const py = read(repo, 'mobile', 'marketing', 'pipeline', 'asc_listing.py');
  const lim = py.match(/LIMITS\s*=\s*\{([^}]*)\}/);
  if (!lim) throw new Error('LIMITS not found in mobile/marketing/pipeline/asc_listing.py');
  const tuple = (n) => {
    const m = py.match(new RegExp(n + String.raw`\s*=\s*\(([^)]*)\)`));
    if (!m) throw new Error(`${n} not found in asc_listing.py`);
    return [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]);
  };
  return {
    limits: Object.fromEntries([...lim[1].matchAll(/"(\w+)":\s*(\d+)/g)].map((m) => [m[1], +m[2]])),
    // whatsNew is in VERSION_FIELDS but ASC rejects it on an app's first version: optional here
    required: [...tuple('INFO_FIELDS'), ...tuple('VERSION_FIELDS')].filter((k) => k !== 'whatsNew'),
  };
}

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();
const words = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);
// Privacy over-claims beyond docs/privacy.html (cloud providers, Apple online recognition and iCloud sync exist).
const OVERCLAIM = [
  /100\s?%/, /completely private/, /fully private/, /totally private/, /perfectly private/, /absolute privacy/,
  /(never|nothing) (ever )?leaves? (your|the) (device|phone|iphone|mac)/, /stays on your device,? always/, /always on[- ]device/,
  /end[- ]to[- ]end/, /zero[- ]knowledge/, /hipaa/, /gdpr[- ](compliant|certified)/, /rodo[- ]?(zgodn|certyfik)/, /no data (is )?collected/,
  /never (uploaded|sent|shared|stored)/, /no data (ever )?leaves/, /stays? on your (device|phone|iphone)(?! only if)/, /never leaves/,
  /nigdy nie (sa|jest) wysyl/, /nie (sa|jest) wysylan\w* (do chmury|nigdzie)/, /nie wysyla\w* (do chmury|nigdzie)/, /nie opuszcza\w* (telefonu|urzadzenia)/,
  /calkowicie prywatn/, /w pelni prywatn/, /100 ?procent/, /nic nie opuszcza/, /nigdy nie opuszcza/, /zawsze na urzadzeniu/,
  /zgodn\w* z rodo/, /szyfrowani\w* end/, /nie zbiera(my)? zadnych danych/,
];
// License: PolyForm Noncommercial is source-available, not open source (OSI).
const LICENSE = [/open[- ]?source/, /\boss\b/, /\bfoss\b/, /otwart\w* ?(kod|zrodl)/, /otwartozrodl/, /wolne oprogramowanie/, /free software/];
// The Mac App Store version is not shipped yet (release-runbook §4): the iOS listing must not advertise it.
const NOT_SHIPPED = [/\bmac(os)?\b/, /\bmaca\b/, /\bmakiem\b/, /\bmacu\b/, /global hotkeys/, /skrot\w* (globaln|klawiszow)/];
// Anthropic / Claude are desktop-only (legal note #3): never in the mobile listing.
const DESKTOP_ONLY = [/anthropic/, /\bclaude\b/];
const FOREVER = [/forever/, /na zawsze/, /for life/, /lifetime/, /bezterminow/, /always free/, /zawsze (za darmo|darmow)/];
const SUPERLATIVE = [/#\s?1\b/, /\bno\.? ?1\b/, /\bbest\b/, /\btop\b/, /number one/, /\b(fastest|most accurate|most private|smartest)\b/,
  /\bnaj(lepsz|szybsz|dokladniejsz|prywatniejsz)/, /\bthe only\b/, /\bjedyn\w* (taka|aplikacj)/, /download (now|today)/, /pobierz (teraz|juz)/];
// Medical / legal transcription claims (not validated for that use).
const REGULATED = [/medical transcri/, /clinical/, /legal transcri/, /court/, /transkrypcj\w* (medyczn|sadow)/, /dokumentacj\w* medyczn/];
// Third-party names are fine in the description (factual provider list) but not in keywords / name / subtitle (2.3.7).
const TRADEMARK_KW = [/open ?ai/, /chatgpt/, /\bgpt/, /gemini/, /alexa/, /copilot/, /notion/, /\bwhisper\b/, /elevenlabs/, /deepgram/, /assembly/, /groq/, /mistral/, /replicate/, /\bsiri\b/, /\bapple\b/, /google/, /otter/, /dragon/];
const PLACEHOLDER = /\{\{|\bTODO\b|\bTBD\b|\bXXX\b|lorem|\[\[/i;
const EMOJI = /\p{Extended_Pictographic}/u;
// Required honest sentences (the cloud caveat and the license), per language.
const REQUIRED = {
  'en-US': [[/process your audio under their own terms/, 'cloud-provider caveat'], [/source-available under the polyform noncommercial/i, 'license'],
    [/only if you turn on Apple online speech/, 'Apple online-speech caveat'], [/shows an estimate/, 'cost is an estimate (ProviderPricing)']],
  pl: [[/przetwarzają nagrania na własnych warunkach/, 'cloud-provider caveat'], [/licencji PolyForm Noncommercial/, 'license'], [/Interfejs aplikacji jest po angielsku/, 'English-only UI disclosure'],
    [/tylko wtedy, gdy włączysz rozpoznawanie online Apple/, 'Apple online-speech caveat'], [/zależy od iOS/, 'on-device language caveat'], [/szacunkowy koszt/, 'cost is an estimate (ProviderPricing)']],
};
const hits = (list, s) => list.filter((re) => re.test(fold(s))).map((re) => re.source);

function bullets(desc) {
  const sec = {}; let cur = '_';
  for (const line of desc.split('\n')) {
    if (/^[A-ZĄĆĘŁŃÓŚŹŻ][A-ZĄĆĘŁŃÓŚŹŻ ,:-]{4,}$/.test(line.trim())) cur = line.trim();
    else if (/^[•-] /.test(line)) sec[cur] = (sec[cur] || 0) + 1;
  }
  return Object.values(sec);
}
function sections(desc) { return desc.split('\n').filter((l) => /^[A-ZĄĆĘŁŃÓŚŹŻ][A-ZĄĆĘŁŃÓŚŹŻ ,:-]{4,}$/.test(l.trim())).length; }

function gate(ios, { limits: ASC, required }) {
  const res = [];
  const out = (ok, where, rule, msg) => res.push({ ok, where, rule, msg });
  for (const [loc, t] of Object.entries(ios)) {
    const where = `appstore ${loc}`;
    const all = Object.entries(t).filter(([, v]) => typeof v === 'string');
    const per = (rule, list, what, fields = all) => {
      const f = fields.flatMap(([k, v]) => hits(list, v).map((h) => `${k}~${h}`));
      out(!f.length, where, rule, f.length ? f.join(' ') : `${what}: none`);
    };
    const missing = required.filter((k) => typeof t[k] !== 'string' || !t[k]);
    out(!missing.length, where, 'fields', missing.length ? 'missing ' + missing.join(',') : `all ${required.length} present`);
    for (const k of ['name', 'subtitle', 'promotionalText', 'description']) out(len(t[k]) > 0 && len(t[k]) <= ASC[k], where, 'limit', `${k} ${len(t[k])}/${ASC[k]} chars`);
    if (t.whatsNew != null) out(len(t.whatsNew) <= ASC.whatsNew, where, 'limit', `whatsNew ${len(t.whatsNew)}/${ASC.whatsNew} chars`);
    const kw = t.keywords || '';
    out(Buffer.byteLength(kw, 'utf8') <= ASC.keywords, where, 'keywords', `${Buffer.byteLength(kw, 'utf8')}/${ASC.keywords} bytes`);
    out(!/\s/.test(kw) && !/^,|,$|,,/.test(kw), where, 'keywords', 'format: no spaces (wasted bytes), no empty entries');
    const folded = kw.split(',').map(fold);
    const dups = folded.filter((k, i) => folded.indexOf(k) !== i);
    out(!dups.length, where, 'keywords', dups.length ? 'duplicates: ' + dups.join(',') : 'no duplicates');
    const toks = folded.flatMap(words);
    const used = new Set([...words(t.name || ''), ...words(t.subtitle || '')]);
    const overlap = [...new Set(toks.filter((w) => used.has(w)))];
    out(!overlap.length, where, 'keywords', overlap.length ? 'repeat name/subtitle: ' + overlap.join(',') : 'no repeats of name/subtitle');
    const head = all.filter(([k]) => ['name', 'subtitle', 'keywords'].includes(k));
    per('trademarks', TRADEMARK_KW, 'third-party names in name/subtitle/keywords (2.3.7)', head);
    out(!/\b(free|gratis)\b|darmow|za darmo|bezplatn/.test(fold(`${t.name} ${t.subtitle}`)), where, 'title', 'no price terms in name/subtitle');
    per('not-shipped', NOT_SHIPPED, 'Mac app (Mac App Store not shipped yet)');
    per('privacy-overclaim', OVERCLAIM, 'privacy claims beyond privacy.html');
    per('license', LICENSE, '"open source" (PolyForm NC is source-available)');
    per('desktop-only', DESKTOP_ONLY, 'Anthropic/Claude (desktop only)');
    per('forever-free', FOREVER, '"forever" promises');
    per('superlatives', SUPERLATIVE, 'superlatives / calls to action');
    per('regulated', REGULATED, 'medical/legal transcription claims');
    const ph = all.filter(([, v]) => PLACEHOLDER.test(v)).map(([k]) => k);
    out(!ph.length, where, 'placeholders', ph.length ? 'in ' + ph.join(',') : 'none');
    const emo = all.filter(([, v]) => EMOJI.test(v)).map(([k]) => k);
    out(!emo.length, where, 'emoji', emo.length ? 'in ' + emo.join(',') : 'none');
    out(/whisperio\.danielkasprzyk\.com\/privacy\.html/.test(t.description || '') && t.privacyPolicyUrl === 'https://whisperio.danielkasprzyk.com/privacy.html', where, 'legal-links', 'privacy URL field + link in description');
    for (const [re, what] of REQUIRED[loc] || []) out(re.test(t.description || ''), where, 'required', `${what} present`);
  }
  if (ios.pl && ios['en-US']) {
    const b = [bullets(ios.pl.description), bullets(ios['en-US'].description)];
    const s = [sections(ios.pl.description), sections(ios['en-US'].description)];
    out(JSON.stringify(b[0]) === JSON.stringify(b[1]) && s[0] === s[1], 'appstore', 'parity', `sections PL ${s[0]} / EN ${s[1]}, bullets PL ${b[0]} / EN ${b[1]}`);
  }
  return res;
}

const load = () => Object.fromEntries(LOCALES.map((l) => [l, json(aso, `app-store.${l}.json`)]));

if (process.argv.includes('--self-test')) {
  const cfg = ascLimits();
  const base = load();
  const C = (loc, txt, rule, field = 'description') => [`${loc} ${field}: ${txt}`, (p) => { p[loc][field] += (field === 'keywords' ? ',' : ' ') + txt; }, rule];
  const CASES = [
    ['clean proposal passes', () => {}, null],
    C('en-US', 'Your voice is 100% private.', 'privacy-overclaim'), C('en-US', 'Nothing ever leaves your device.', 'privacy-overclaim'),
    C('en-US', 'End-to-end encrypted.', 'privacy-overclaim'), C('en-US', 'GDPR-compliant and HIPAA ready.', 'privacy-overclaim'),
    C('pl', 'Całkowicie prywatne dyktowanie.', 'privacy-overclaim'), C('pl', 'Nagranie nigdy nie opuszcza telefonu.', 'privacy-overclaim'),
    C('pl', 'Zgodne z RODO.', 'privacy-overclaim'), C('en-US', 'No data is collected.', 'privacy-overclaim'),
    C('en-US', 'Fully open-source.', 'license'), C('pl', 'Otwarty kod źródłowy.', 'license'),
    C('en-US', 'Cleanup with Claude by Anthropic.', 'desktop-only'),
    C('en-US', 'Free forever.', 'forever-free'), C('pl', 'Za darmo na zawsze.', 'forever-free'),
    C('en-US', 'The most accurate dictation app.', 'superlatives'), C('pl', 'Najlepsze dyktowanie.', 'superlatives'),
    C('en-US', 'Great for medical transcription.', 'regulated'),
    // adversarial strings from the Opus review of docs/aso-1.4.1 (all passed the first version)
    C('en-US', 'Your recordings stay on your iPhone and are never uploaded anywhere.', 'privacy-overclaim'),
    C('en-US', 'No data leaves your device.', 'privacy-overclaim'),
    C('pl', 'Twoje nagrania nigdy nie są wysyłane do chmury.', 'privacy-overclaim'),
    C('en-US', 'Opensource dictation.', 'license'), C('pl', 'Otwartoźródłowy projekt.', 'license'),
    ['GPT in subtitle', (p) => { p['en-US'].subtitle = 'GPT-4o Voice Typing, Your Key'; }, 'trademarks'],
    ['Open AI in subtitle', (p) => { p['en-US'].subtitle = 'Voice Typing via Open AI Key'; }, 'trademarks'],
    ['darmowe in PL name', (p) => { p.pl.name = 'Whisperio – darmowe dyktowanie'; }, 'title'],
    ['bezpłatne in PL subtitle', (p) => { p.pl.subtitle = 'Bezpłatne dyktowanie'; }, 'title'],
    C('en-US', 'Native Mac app with global hotkeys.', 'not-shipped'), C('pl', 'Synchronizacja z Makiem.', 'not-shipped'),
    ['cost estimate caveat removed', (p) => { p['en-US'].description = p['en-US'].description.replace('shows an estimate', 'shows the cost'); }, 'required'],
    C('en-US', 'openai', 'trademarks', 'keywords'), C('pl', 'whisper', 'trademarks', 'keywords'),
    ['name with free', (p) => { p['en-US'].name = 'Whisperio – Free Dictation'; }, 'title'],
    ['keyword with space', (p) => { p['en-US'].keywords = p['en-US'].keywords.replace('memo', 'voice memo'); }, 'keywords'],
    ['keyword repeats subtitle', (p) => { p['en-US'].keywords = p['en-US'].keywords.replace('memo', 'typing'); }, 'keywords'],
    ['keywords over 100 bytes', (p) => { p.pl.keywords += ',zamianamowynatekst'; }, 'keywords'],
    ['cloud caveat removed', (p) => { p['en-US'].description = p['en-US'].description.replace('process your audio under their own terms', 'are great'); }, 'required'],
    ['English UI disclosure removed', (p) => { p.pl.description = p.pl.description.replace('Interfejs aplikacji jest po angielsku. ', ''); }, 'required'],
    ['privacy link removed', (p) => { p.pl.description = p.pl.description.replace(/https:\/\/whisperio\.danielkasprzyk\.com\/privacy\.html/g, ''); }, 'legal-links'],
    ['parity broken', (p) => { p.pl.description = p.pl.description.replace('- Własny słownik\n', ''); }, 'parity'],
    ['promo over limit', (p) => { p.pl.promotionalText += ' '.repeat(60); }, 'limit'],
    ['placeholder', (p) => { p['en-US'].promotionalText = p['en-US'].promotionalText.slice(0, 120) + ' {{link}}'; }, 'placeholders'],
  ];
  let bad = 0;
  for (const [name, mutate, rule] of CASES) {
    const p = JSON.parse(JSON.stringify(base));
    mutate(p);
    const fails = gate(p, cfg).filter((r) => !r.ok);
    const ok = rule == null ? fails.length === 0 : fails.some((r) => r.rule === rule);
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'MISS'} ${name}${rule ? ` -> ${rule}` : ''}${ok ? '' : ` (got: ${fails.map((r) => r.rule + ':' + r.msg).join(' | ') || 'nothing'})`}`);
  }
  console.log(bad ? `SELF-TEST: FAIL (${bad}/${CASES.length})` : `SELF-TEST: PASS (${CASES.length} cases)`);
  process.exit(bad ? 1 : 0);
}

const cfg = ascLimits();
const ios = load();
const results = gate(ios, cfg);
let fails = 0;
for (const r of results) {
  if (!r.ok) fails++;
  if (!r.ok || !quiet) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.where} ${r.rule}: ${r.msg}`);
}
if (!quiet) {
  console.log('\nCOMPARE current -> proposed (chars; * = text changed; "new" = locale not in the repo yet)');
  for (const loc of LOCALES) {
    const p = join(repo, 'mobile', 'marketing', 'listing', `${loc}.json`);
    const old = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
    for (const k of ['name', 'subtitle', 'promotionalText', 'keywords', 'description']) {
      const a = old ? old[k] || '' : null, b = ios[loc][k];
      console.log(`  ${loc} ${k}: ${a == null ? 'new' : len(a)} -> ${len(b)}${a != null && a !== b ? ' *' : ''}`);
    }
    if (old) {
      const A = new Set(old.keywords.split(',')), B = new Set(ios[loc].keywords.split(','));
      console.log(`    keywords +[${[...B].filter((x) => !A.has(x))}] -[${[...A].filter((x) => !B.has(x))}]`);
    }
  }
}
console.log(fails ? `RESULT: FAIL (${fails})` : `RESULT: PASS (${results.length} checks)`);
process.exit(fails ? 1 : 0);
