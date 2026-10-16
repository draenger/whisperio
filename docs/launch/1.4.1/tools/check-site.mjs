#!/usr/bin/env node
// Static gate for the Whisperio site (docs/*.html, GitHub Pages, no build step). Offline, read-only, Node >= 18,
// Windows + macOS. Exit 1 on any FAIL.
//   node docs/launch/1.4.1/tools/check-site.mjs              check docs/
//   node docs/launch/1.4.1/tools/check-site.mjs --self-test  every planted defect must be caught
//
// Rules
//   appstore-flag  <html data-appstore-live>: "false" -> no apps.apple.com anywhere, no apple-itunes-app meta, no
//                  installUrl/downloadUrl on the MobileApplication JSON-LD, the badge is a non-link "Coming soon" label.
//                  "true" -> apple-itunes-app meta with the same id as data-appstore-id (the URL itself is built by JS).
//   claims         no "open source" (PolyForm Noncommercial = source-available), no 100% / fully private, no
//                  "forever", no superlatives, no Anthropic/Claude inside the iPhone section (desktop only).
//   ios-section    #ios exists, carries the Apple online-recognition caveat from privacy.html 4.1, the
//                  "transcripts and metadata, no audio" iCloud fact and the English-only UI note.
//   seo            one <title> (<= 65 chars), meta description mentions iPhone, og/twitter descriptions present,
//                  JSON-LD parses and has a MobileApplication node with softwareVersion + license.
//   headings       exactly one <h1>; no skipped heading levels.
//   responsive     viewport meta; the #ios bento collapses to one column at <= 600 px (whisperio.css).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ID = '6781780531';
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const text = (h) => decode(strip(h).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
// every attribute value (alt, title, aria-label, href, content...) decoded: claims and store URLs hide there too
const attrs = (h) => decode([...strip(h).matchAll(/\s[\w:-]+\s*=\s*("[^"]*"|'[^']*')/g)].map((m) => m[1].slice(1, -1)).join(' '));
const ldBlocks = (h) => [...h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
const metas = (h) => [...h.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
const metaContent = (h, attr, name) => {
  const tag = metas(h).find((t) => new RegExp(`${attr}=["']${name}["']`, 'i').test(t));
  return tag ? (tag.match(/content=["']([^"']*)["']/i) || [])[1] : null;
};
const CLAIMS = [/open[- ]?source/i, /\bOSS\b/, /\b100\s*%\s*(private|privacy|secure|offline|on[- ]?device|local)/i, /never leaves your (ipad|watch|iphone|mac)/i, /(fully|completely|totally) private/i, /\bforever\b/i,
  /best[- ]in[- ]class/i, /\bthe best\b/i, /#\s?1\b/, /\bnumber one\b/i, /never leaves your (device|phone)/i, /end[- ]to[- ]end/i];

export function checkSite(pages, css) {
  const res = [];
  const out = (ok, page, rule, msg) => res.push({ ok, page, rule, msg });
  for (const [name, html] of Object.entries(pages)) {
    // claims run on visible text AND meta/JSON-LD (what search engines show), everywhere on the site
    const visible = text(html), head = metas(html).join(' ') + ' ' + (html.match(/<title>[\s\S]*?<\/title>/i) || [''])[0];
    const ldText = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join(' ');
    const at = attrs(html);
    const claimHits = CLAIMS.filter((re) => re.test(visible) || re.test(head) || re.test(ldText) || re.test(at)).map((re) => re.source);
    out(!claimHits.length, name, 'claims', claimHits.length ? claimHits.join(' | ') : 'none');
  }
  const h = pages['index.html'];
  if (!h) { out(false, 'index.html', 'exists', 'missing'); return res; }
  const htmlTag = (h.match(/<html\b[^>]*>/i) || [''])[0];
  const live = (htmlTag.match(/data-appstore-live="([^"]*)"/) || [])[1];
  const id = (htmlTag.match(/data-appstore-id="([^"]*)"/) || [])[1];
  out(live === 'true' || live === 'false', 'index.html', 'appstore-flag', `data-appstore-live="${live}"`);
  out(id === APP_ID, 'index.html', 'appstore-flag', `data-appstore-id="${id}" (expected ${APP_ID})`);
  // every ld+json block is parsed: a second block must not smuggle an installUrl in
  const lds = ldBlocks(h).map((b) => { try { return JSON.parse(b); } catch { return null; } });
  const ld = lds.length && lds.every(Boolean) ? lds[0] : null;
  out(!!ld, 'index.html', 'seo', ld ? `JSON-LD parses (${lds.length} block(s))` : 'JSON-LD missing or invalid');
  const nodes = lds.filter(Boolean).flatMap((l) => l['@graph'] || [l]);
  const mob = nodes.find((n) => [].concat(n['@type']).includes('MobileApplication'));
  out(!!(mob && mob.softwareVersion && mob.license), 'index.html', 'seo', mob ? `MobileApplication ${mob.softwareVersion}` : 'no MobileApplication node');
  const banner = metaContent(h, 'name', 'apple-itunes-app');
  if (live !== 'true') {
    // visible text, decoded attributes and every JSON-LD block (the inline flag script only holds a URL prefix that never runs)
    const STORE = /apps\.apple\.com|itunes\.apple\.com/i;
    const store = Object.entries(pages).filter(([, x]) => STORE.test(text(x)) || STORE.test(attrs(x)) || ldBlocks(x).some((b) => STORE.test(b))).map(([n]) => n);
    out(!store.length, 'site', 'appstore-flag', store.length ? 'App Store URL present while the flag is OFF in ' + store.join(',') : 'no App Store URL while OFF');
    out(banner == null, 'index.html', 'appstore-flag', banner == null ? 'no apple-itunes-app banner while OFF' : 'apple-itunes-app banner present while OFF');
    const isMob = (n) => [].concat(n['@type']).includes('MobileApplication');
    out(!nodes.some((n) => (isMob(n) && (n.installUrl || n.downloadUrl)) || /apps.apple.com/i.test(String(n.installUrl || '') + String(n.downloadUrl || ''))), 'index.html', 'appstore-flag', 'no installUrl/downloadUrl on any MobileApplication node (nor any App Store URL) while OFF');
    const badge = (h.match(/<(\w+)\b[^>]*data-appstore-badge[^>]*>[\s\S]*?<\/\1>/) || [])[0] || '';
    out(/^<span\b/.test(badge) && /Coming soon to the App Store/.test(badge), 'index.html', 'appstore-flag', badge ? 'badge is a non-link "Coming soon" label' : 'no [data-appstore-badge]');
  } else {
    out(banner === `app-id=${id}`, 'index.html', 'appstore-flag', `apple-itunes-app = "${banner}" (expected app-id=${id})`);
  }
  // iPhone section
  const ios = (h.match(/<section\b[^>]*id="ios"[\s\S]*?<\/section>/) || [])[0] || '';
  out(!!ios && !/<section\b[^>]*id="ios"[^>]*\bhidden\b/.test(ios), 'index.html', 'ios-section', ios ? '#ios present and not hidden' : '#ios missing');
  const it = text(ios);
  for (const [re, what] of [[/only if you turn on online recognition in Settings/, 'Apple online-recognition caveat'], [/tells you instead of sending audio anywhere/, 'no silent server fallback (AppleSpeechProvider)'],
    [/transcripts and metadata, no audio/, 'iCloud: transcripts and metadata, no audio'], [/interface is in English/, 'English-only UI'],
    [/No account/i, 'no account'], [/(no|No) analytics/, 'no analytics']]) out(re.test(it), 'index.html', 'ios-section', what);
  out(!/anthropic|claude/i.test(it), 'index.html', 'ios-section', 'no Anthropic/Claude in the iPhone section (desktop only)');
  // facts the code contradicts: silent fallback to Apple servers; Mac App Store app / CloudKit on Mac (not shipped)
  const wrong = [/or your language is not available on-device/i, /\bMac\b/, /lands where you are (already )?typing/i].filter((re) => re.test(it)).map((re) => re.source);
  out(!wrong.length, 'index.html', 'ios-section', wrong.length ? 'contradicts the code: ' + wrong.join(' | ') : 'no claim the code contradicts');
  // SEO
  const title = ((h.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/&amp;/g, '&');
  out(title.length > 0 && title.length <= 65, 'index.html', 'seo', `title ${title.length}/65 chars`);
  out(/iPhone/.test(metaContent(h, 'name', 'description') || ''), 'index.html', 'seo', 'meta description mentions iPhone');
  out(!!metaContent(h, 'property', 'og:description') && !!metaContent(h, 'name', 'twitter:description'), 'index.html', 'seo', 'og + twitter descriptions');
  // headings
  const hs = [...strip(h).matchAll(/<h([1-6])\b/gi)].map((m) => +m[1]);
  out(hs.filter((x) => x === 1).length === 1, 'index.html', 'headings', `${hs.filter((x) => x === 1).length} <h1>`);
  const skips = hs.map((l, i) => (i && l > hs[i - 1] + 1 ? `h${hs[i - 1]}->h${l}` : null)).filter(Boolean);
  out(!skips.length, 'index.html', 'headings', skips.length ? 'skipped: ' + skips.join(',') : 'no skipped levels');
  // responsive
  out(/<meta name="viewport"[^>]*width=device-width/i.test(h), 'index.html', 'responsive', 'viewport meta');
  out(/@media \(max-width: 600px\) \{ #ios \.bento \{ grid-template-columns: 1fr; \} \}/.test(css), 'whisperio.css', 'responsive', '#ios bento is one column at <= 600 px');
  return res;
}

function selfTest(pages, css) {
  const C = [
    ['current site passes', (p) => p, null],
    ['open source in title', (p) => ({ ...p, 'index.html': p['index.html'].replace('<title>', '<title>Open-Source ') }), 'claims'],
    ['open source in og', (p) => ({ ...p, 'index.html': p['index.html'].replace('<meta property="og:description" content="', '<meta property="og:description" content="Open source. ') }), 'claims'],
    ['100% private in body', (p) => ({ ...p, 'index.html': p['index.html'].replace('</main>', '<p>100% private.</p></main>').replace('</footer>', '<p>100% private</p></footer>') }), 'claims'],
    ['forever on app.html', (p) => ({ ...p, 'app.html': (p['app.html'] || '<html></html>').replace('</html>', '<p>Free forever</p></html>') }), 'claims'],
    ['store link while OFF', (p) => ({ ...p, 'index.html': p['index.html'].replace('<footer', `<a href="https://apps.apple.com/app/id${APP_ID}">x</a><footer`) }), 'appstore-flag'],
    ['banner while OFF', (p) => ({ ...p, 'index.html': p['index.html'].replace('</head>', `<meta name="apple-itunes-app" content="app-id=${APP_ID}"></head>`) }), 'appstore-flag'],
    ['installUrl while OFF', (p) => ({ ...p, 'index.html': p['index.html'].replace('"softwareVersion": "1.4.1",', `"softwareVersion": "1.4.1", "installUrl": "https://apps.apple.com/app/id${APP_ID}",`) }), 'appstore-flag'],
    ['flag ON without banner', (p) => ({ ...p, 'index.html': p['index.html'].replace('data-appstore-live="false"', 'data-appstore-live="true"') }), 'appstore-flag'],
    ['badge became a link while OFF', (p) => ({ ...p, 'index.html': p['index.html'].replace('<span class="btn-dl appstore-badge" data-appstore-badge', '<a class="btn-dl appstore-badge" data-appstore-badge').replace('Coming soon to the App Store</span>\n      </span>', 'Coming soon to the App Store</span>\n      </a>').replace('Coming soon to the App Store</span>\r\n      </span>', 'Coming soon to the App Store</span>\r\n      </a>') }), 'appstore-flag'],
    ['online-recognition caveat removed', (p) => ({ ...p, 'index.html': p['index.html'].replace('only if you turn on online recognition in Settings', 'when needed') }), 'ios-section'],
    // the 8 adversarial edits from the Opus review
    ['open-source in an alt attribute', (p) => ({ ...p, 'index.html': p['index.html'].replace('<footer', '<img src="x.png" alt="Open-source dictation"><footer') }), 'claims'],
    ['100% offline', (p) => ({ ...p, 'index.html': p['index.html'].replace('<footer', '<p>100% offline</p><footer') }), 'claims'],
    ['Opensource without separator', (p) => ({ ...p, 'index.html': p['index.html'].replace('<footer', '<p>Opensource</p><footer') }), 'claims'],
    ['store URL in JSON-LD sameAs while OFF', (p) => ({ ...p, 'index.html': p['index.html'].replace('"softwareVersion": "1.4.1",', `"softwareVersion": "1.4.1", "sameAs": "https://apps.apple.com/app/id${APP_ID}",`) }), 'appstore-flag'],
    ['entity-encoded store href while OFF', (p) => ({ ...p, 'index.html': p['index.html'].replace('<footer', `<a href="https://apps.apple&#46;com/app/id${APP_ID}">x</a><footer`) }), 'appstore-flag'],
    ['second JSON-LD block with installUrl while OFF', (p) => ({ ...p, 'index.html': p['index.html'].replace('</head>', `<script type="application/ld+json">{"@type":"MobileApplication","installUrl":"x"}</script></head>`) }), 'appstore-flag'],
    ['#ios hidden', (p) => ({ ...p, 'index.html': p['index.html'].replace('id="ios"', 'id="ios" hidden') }), 'ios-section'],
    ['silent-fallback wording back', (p) => ({ ...p, 'index.html': p['index.html'].replace('If your language isn', 'Or your language is not available on-device. If your language isn') }), 'ios-section'],
    ['Mac in the iCloud line', (p) => ({ ...p, 'index.html': p['index.html'].replace('between your iPhone and iPad', 'between your iPhone, iPad and Mac') }), 'ios-section'],
    ['Anthropic in iPhone section', (p) => ({ ...p, 'index.html': p['index.html'].replace('OpenAI, ElevenLabs, Deepgram', 'Anthropic, OpenAI, ElevenLabs, Deepgram') }), 'ios-section'],
    ['second h1', (p) => ({ ...p, 'index.html': p['index.html'].replace('<h2>Dictation in your pocket', '<h1>Dictation in your pocket').replace('own AI key.</h2>', 'own AI key.</h1>') }), 'headings'],
    ['skipped heading', (p) => ({ ...p, 'index.html': p['index.html'].replace('<h2>Dictation in your pocket', '<h4>Dictation in your pocket').replace('own AI key.</h2>', 'own AI key.</h4>') }), 'headings'],
    ['long title', (p) => ({ ...p, 'index.html': p['index.html'].replace('<title>', '<title>A very long prefix that pushes the title way past the limit ') }), 'seo'],
    ['mobile CSS removed', (p) => p, 'responsive', ''],
  ];
  let bad = 0;
  for (const [name, mut, rule, cssOverride] of C) {
    const fails = checkSite(mut({ ...pages }), cssOverride ?? css).filter((r) => !r.ok);
    const ok = rule == null ? !fails.length : fails.some((r) => r.rule === rule);
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'MISS'} ${name}${rule ? ' -> ' + rule : ''}${ok ? '' : ' (got: ' + (fails.map((r) => r.rule + ':' + r.msg).join(' | ') || 'nothing') + ')'}`);
  }
  console.log(bad ? `SELF-TEST: FAIL (${bad}/${C.length})` : `SELF-TEST: PASS (${C.length} cases)`);
  process.exit(bad ? 1 : 0);
}

const here = dirname(fileURLToPath(import.meta.url));
const docs = resolve(here, '..', '..', '..');
const pages = Object.fromEntries(readdirSync(docs).filter((f) => f.endsWith('.html')).map((f) => [f, readFileSync(join(docs, f), 'utf8')]));
const cssPath = join(docs, 'assets', 'whisperio.css');
const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : '';
if (process.argv.includes('--self-test')) selfTest(pages, css);
const res = checkSite(pages, css);
let fails = 0;
for (const r of res) { if (!r.ok) fails++; if (!r.ok || !process.argv.includes('--quiet')) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.page} ${r.rule}: ${r.msg}`); }
console.log(fails ? `RESULT: FAIL (${fails})` : `RESULT: PASS (${res.length} checks)`);
process.exit(fails ? 1 : 0);
