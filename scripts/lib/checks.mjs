import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { STATES, INERT_KEYS, BASE58, HEX40, isStated, looksLikeAddress, parseTokens } from './register.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEXT_EXT = new Set(['.html', '.css', '.js', '.svg', '.json', '.txt', '']);

export function walk(dir, skip = () => false) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (skip(p, e)) continue;
    if (e.isDirectory()) out.push(...walk(p, skip)); else out.push(p);
  }
  return out;
}

const rel = (ctx, p) => path.relative(ctx.dist, p).split(path.sep).join('/');
const textFiles = (ctx) => walk(ctx.dist).filter((p) => TEXT_EXT.has(path.extname(p)));
const html = (ctx) => fs.readFileSync(path.join(ctx.dist, 'index.html'), 'utf8');
const ok = (msg = '') => ({ ok: true, msg });
const fail = (msg) => ({ ok: false, msg });

/* ---- address scanner: match address-shaped strings against stated records; never blanket-reject 0x ---- */
export function scanAddresses(text, statedValues) {
  const bad = [];
  for (const m of text.matchAll(new RegExp(HEX40.source, 'g'))) if (!statedValues.has(m[0])) bad.push(m[0]);
  const rest = text.replace(new RegExp(HEX40.source, 'g'), ' ');
  for (const m of rest.matchAll(new RegExp(BASE58.source, 'g'))) if (!statedValues.has(m[0])) bad.push(m[0]);
  return bad;
}
const statedValues = (records) => new Set(Object.values(records).filter(isStated).map((r) => r.value).filter(Boolean));

/* ---- visible-date detector ---- */
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
export const DATE_PATTERNS = [
  /\b(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])\b/,
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'i'),
  new RegExp(`\\b\\d{1,2}\\s+${MONTH}\\s+(?:19|20)\\d{2}\\b`, 'i'),
  /\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm)?\b/i,
  /\bas of\b/i,
  /\bchecked\b/i,
  /\btimestamp\b/i,
  /\blast updated\b/i,
];
const stripMarkup = (h) => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
const RUNTIME_DATE = /\bnew Date\b|Date\.now|toLocale(?:Date|Time)String|Intl\.DateTimeFormat|getFullYear/;

/* ====================================================== checks ====================================================== */
export const CHECKS = {
  'dist-entry': async (ctx) => (fs.existsSync(path.join(ctx.dist, 'index.html')) ? ok('dist/index.html present') : fail('dist/index.html missing')),

  'logo-in-dist': async (ctx) => {
    const h = html(ctx);
    const refs = [...h.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((r) => !/^(https?:|#|data:)/.test(r));
    const problems = [];
    for (const r of refs) {
      if (r.startsWith('/') || r.includes('..')) problems.push(`non-relative ${r}`);
      else if (!fs.existsSync(path.join(ctx.dist, r))) problems.push(`missing ${r}`);
    }
    for (const must of ['assets/mark-160.png', 'assets/mark-720.png']) {
      if (!refs.includes(must)) problems.push(`index.html does not reference ${must}`);
      else if (!fs.existsSync(path.join(ctx.dist, must))) problems.push(`missing ${must}`);
      else {
        const meta = await sharp(path.join(ctx.dist, must)).metadata();
        if (!meta.hasAlpha || meta.width < 50) problems.push(`${must} unreadable or opaque`);
      }
    }
    return problems.length ? fail(problems.join('; ')) : ok(`${refs.length} local refs resolve, relative, logo files decode with alpha`);
  },

  'logo-premultiplied-edge': async (ctx) => {
    const { data, info } = await sharp(path.join(ctx.dist, 'assets/mark-720.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let semi = 0, dark = 0;
    for (let i = 0; i < info.width * info.height; i++) {
      const a = data[i * 4 + 3];
      if (a > 8 && a < 247) { semi++; if (Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < 48) dark++; }
    }
    const ratio = semi ? dark / semi : 0;
    return ratio < 0.03 ? ok(`dark-fringe ratio ${(ratio * 100).toFixed(2)}% of ${semi} edge pixels`) : fail(`dark fringe ${(ratio * 100).toFixed(1)}%`);
  },

  'favicon': async (ctx) => {
    const p = path.join(ctx.dist, 'favicon.svg');
    if (!fs.existsSync(p)) return fail('favicon.svg missing');
    const s = fs.readFileSync(p, 'utf8');
    const tokens = parseTokens(fs.readFileSync(path.join(ctx.dist, 'assets/css/tokens.css'), 'utf8'));
    const palette = new Set(Object.values(tokens).map((t) => t.hex));
    const problems = [];
    if (/--/.test(s) || /<!--/.test(s)) problems.push('contains a double hyphen or comment');
    if (!/viewBox="0 0 32 32"/.test(s) || !/width="32"/.test(s) || !/height="32"/.test(s)) problems.push('not 32x32');
    const fills = [...s.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
    if (fills.length < 20) problems.push('too few traced rects');
    if (fills.some((f) => !palette.has(f))) problems.push('fill outside token palette');
    if (!/rel="icon"[^>]*href="favicon\.svg"/.test(html(ctx))) problems.push('index.html does not link favicon.svg');
    return problems.length ? fail(problems.join('; ')) : ok(`${fills.length} traced rects, all token colours`);
  },

  'palette-provenance': async (ctx) => {
    const css = fs.readFileSync(path.join(ctx.dist, 'assets/css/tokens.css'), 'utf8');
    const tokens = parseTokens(css);
    const names = Object.keys(tokens);
    if (names.length < 12) return fail(`only ${names.length} provenance notes`);
    const cache = new Map();
    const bad = [];
    for (const n of names) {
      const t = tokens[n];
      const file = path.join(ROOT, 'brand', path.basename(t.file));
      if (!cache.has(file)) cache.set(file, await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
      const { data, info } = cache.get(file);
      const i = (t.y * info.width + t.x) * 4;
      const hex = '#' + [0, 1, 2].map((k) => data[i + k].toString(16).padStart(2, '0')).join('');
      if (hex !== t.hex) bad.push(`${n}: ${t.hex} vs pixel ${hex} @${t.x},${t.y}`);
    }
    return bad.length ? fail(bad.join('; ')) : ok(`${names.length} tokens each equal their real source pixel`);
  },

  'colour-literals-confined': async (ctx) => {
    const offenders = [];
    for (const p of textFiles(ctx)) {
      const r = rel(ctx, p);
      if (r === 'assets/css/tokens.css' || r === 'favicon.svg') continue;
      const t = fs.readFileSync(p, 'utf8');
      if (/(?<![&\w])#[0-9a-fA-F]{8}\b|(?<![&\w])#[0-9a-fA-F]{6}\b|(?<![&\w])#[0-9a-fA-F]{3,4}\b(?![-\w])/.test(t)) offenders.push(r);
      else if (/\b(?:rgb|rgba|hsl|hsla)\(/.test(t)) offenders.push(`${r} (functional colour)`);
    }
    return offenders.length ? fail(`literals in ${offenders.join(', ')}`) : ok('hex/rgb/hsl literals only in tokens.css (+ generated favicon)');
  },

  'no-ch-units': async (ctx) => {
    const hits = textFiles(ctx).filter((p) => /\d(?:\.\d+)?ch\b/.test(fs.readFileSync(p, 'utf8'))).map((p) => rel(ctx, p));
    return hits.length ? fail(`ch unit in ${hits.join(', ')}`) : ok('no ch units');
  },

  'no-dates': async (ctx) => {
    const hits = [];
    for (const p of textFiles(ctx)) {
      const t = fs.readFileSync(p, 'utf8');
      const scan = p.endsWith('.html') ? stripMarkup(t) + ' ' + [...t.matchAll(/(?:aria-label|title|alt|content)="([^"]*)"/g)].map((m) => m[1]).join(' ') : t;
      for (const re of DATE_PATTERNS) if (re.test(scan)) hits.push(`${rel(ctx, p)} ~ ${re}`);
      if (p.endsWith('.html') && /\b(?:19|20)\d{2}\b/.test(stripMarkup(t))) hits.push(`${rel(ctx, p)} ~ bare year`);
      if (p.endsWith('.js') && RUNTIME_DATE.test(t)) hits.push(`${rel(ctx, p)} ~ runtime date API`);
    }
    const stray = walk(ctx.dist).filter((p) => /register/i.test(path.basename(p)));
    if (stray.length) hits.push('register shipped in dist');
    return hits.length ? fail(hits.join('; ')) : ok('no dates, clocks, "as of" or runtime date APIs in text, aria, titles or scripts');
  },

  'register-shape': async (ctx) => {
    const problems = [];
    for (const [k, r] of Object.entries(ctx.records)) {
      if (!STATES.includes(r.state)) problems.push(`${k}: bad state`);
      if (!isStated(r)) {
        const extra = Object.keys(r).filter((x) => !INERT_KEYS.includes(x));
        if (extra.length) problems.push(`${k}: inert record carries ${extra.join(',')}`);
      } else if (r.url && !/^https:\/\//.test(r.url)) problems.push(`${k}: url not https`);
    }
    if (isStated(ctx.records.ca) && !looksLikeAddress(ctx.records.ca.value || '')) problems.push('ca: stated value is not address-shaped');
    return problems.length ? fail(problems.join('; ')) : ok(`${Object.keys(ctx.records).length} records valid, inert ones carry no value or url`);
  },

  'link-rule': async (ctx) => {
    const h = html(ctx);
    const allowed = new Set(Object.values(ctx.records).filter((r) => isStated(r) && r.url && !r.pairsUrl).map((r) => r.url));
    const problems = [];
    for (const m of h.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)) {
      const href = m[1];
      if (href.startsWith('#')) continue;
      if (!allowed.has(href)) problems.push(`href ${href} not backed by a stated record`);
    }
    for (const key of ['x', 'github']) {
      const rec = ctx.records[key];
      const el = h.match(new RegExp(`<(a|span)\\b[^>]*data-social="${key}"[^>]*>`));
      if (!el) { problems.push(`${key} icon missing`); continue; }
      const hasHref = /\bhref=/.test(el[0]);
      if (isStated(rec) && (el[1] !== 'a' || !el[0].includes(`href="${rec.url}"`))) problems.push(`${key} stated but not linked to its url`);
      if (!isStated(rec) && (hasHref || el[1] === 'a')) problems.push(`${key} unstated but has href`);
    }
    const chips = [...h.matchAll(/<(a|span)\b[^>]*data-chip="(\w+)"[^>]*>/g)];
    for (const [tag, kind, key] of chips) if ((kind === 'a') !== isStated(ctx.records[key])) problems.push(`footer chip ${key} disagrees with register`);
    return problems.length ? fail(problems.join('; ')) : ok('every href is backed by a stated record; unstated icons are inert spans');
  },

  'social-always-top-right': async (ctx) => {
    const h = html(ctx);
    const bar = h.match(/<header class="bar wrap">([\s\S]*?)<\/header>/);
    if (!bar || !bar[1].includes('data-social-group')) return fail('social group not inside header bar');
    const icons = [...bar[1].matchAll(/data-social="(\w+)"/g)].map((m) => m[1]);
    const css = fs.readFileSync(path.join(ctx.dist, 'assets/css/site.css'), 'utf8');
    if (icons.join() !== 'x,github') return fail(`icons present: ${icons.join()}`);
    if (/\.social\s*\{[^}]*display:\s*none/.test(css) || /\.social__btn\s*\{[^}]*display:\s*none/.test(css)) return fail('social hidden at some breakpoint');
    if (/<svg[\s\S]*?<\/svg>\s*<span[^>]*>\s*(X|GitHub)\s*</.test(bar[1])) return fail('text label inside icon button');
    return ok('both icons in header, icon only, never display:none');
  },

  'ca-slot': async (ctx) => {
    const h = html(ctx);
    const m = h.match(/<(button|div)\b[^>]*data-slot="contract"[^>]*>([\s\S]*?)<\/\1>/);
    if (!m) return fail('contract slot missing');
    const rec = ctx.records.ca;
    const slot = m[0];
    const top = h.indexOf('data-slot="contract"') < h.indexOf('<main');
    if (!top) return fail('slot is not above main content');
    if (isStated(rec)) {
      if (m[1] !== 'button' || !slot.includes(`<span class="ca__addr">${rec.value}</span>`)) return fail('stated: full address missing or slot not a button');
      return ok('stated branch: full address rendered in a click-to-copy button');
    }
    const problems = [];
    if (m[1] === 'button') problems.push('inert slot is a button');
    if (!/aria-disabled="true"/.test(slot)) problems.push('missing aria-disabled');
    if (/href=|data-copy|value=/.test(slot)) problems.push('inert slot carries href/value');
    if (scanAddresses(slot, new Set()).length) problems.push('inert slot contains an address-shaped string');
    if (!/>pending</.test(slot)) problems.push('pending text missing');
    return problems.length ? fail(problems.join('; ')) : ok(`${rec.state} branch: inert slot shows label and "pending" only`);
  },

  'address-scan': async (ctx) => {
    const allowed = statedValues(ctx.records);
    const bad = [];
    for (const p of textFiles(ctx)) bad.push(...scanAddresses(fs.readFileSync(p, 'utf8'), allowed).map((a) => `${rel(ctx, p)}: ${a}`));
    return bad.length ? fail(`unregistered address-shaped strings: ${bad.join(', ')}`) : ok(`scanned ${textFiles(ctx).length} files; every address-shaped string matches a stated record`);
  },

  'csp-and-scripts': async (ctx) => {
    const h = html(ctx);
    const problems = [];
    if (!/Content-Security-Policy/.test(h)) problems.push('no CSP');
    for (const m of h.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (!/src="assets\/js\/[\w.-]+"/.test(m[1])) problems.push('script not a local asset');
      if (m[2].trim()) problems.push('inline script body');
    }
    if (/\sstyle="/.test(h)) problems.push('inline style attribute');
    return problems.length ? fail(problems.join('; ')) : ok('CSP present, scripts are local files only');
  },

  'reduced-motion': async (ctx) => {
    const css = fs.readFileSync(path.join(ctx.dist, 'assets/css/site.css'), 'utf8');
    const motion = fs.readFileSync(path.join(ctx.dist, 'assets/js/motion.js'), 'utf8');
    const market = fs.readFileSync(path.join(ctx.dist, 'assets/js/market.js'), 'utf8');
    const block = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/);
    const problems = [];
    if (!block || !/animation:\s*none\s*!important/.test(block[1]) || !/transition:\s*none\s*!important/.test(block[1])) problems.push('css fallback incomplete');
    if (!/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(motion)) problems.push('motion.js does not read the preference');
    if (!/reduced\(\)/.test(market)) problems.push('market.js ignores the preference');
    for (const fn of ['initReveal', 'initParallax', 'initMesh']) {
      if (!new RegExp(`function ${fn}[\\s\\S]*?reduced\\(\\)`).test(motion)) problems.push(`${fn} lacks reduced branch`);
    }
    return problems.length ? fail(problems.join('; ')) : ok('css kills all animation/transition; spring, parallax, mesh, tween, flash all branch on the preference');
  },

  'market-independent-of-ca': async (ctx) => {
    const market = fs.readFileSync(path.join(ctx.dist, 'assets/js/market.js'), 'utf8');
    const hit = market.match(/\bca\b|contract|data-slot|ca__|register|isStated/i);
    const h = html(ctx);
    const m = ctx.records.market;
    const problems = [];
    if (hit) problems.push(`market.js mentions "${hit[0]}"`);
    if (!h.includes(`data-boosts-url="${m.url}"`) || !h.includes(`data-pairs-url="${m.pairsUrl}"`)) problems.push('body market urls differ from market record');
    return problems.length ? fail(problems.join('; ')) : ok('market module never reads CA state; urls come from the market record only');
  },

  'market-behaviour': async (ctx) => {
    const s = fs.readFileSync(path.join(ctx.dist, 'assets/js/market.js'), 'utf8');
    const need = [
      ['POLL_MS = 60000', 'poll every 60s'], ['visibilitychange', 'pause/resume on visibility'], ['document.hidden', 'hidden check'],
      ['2 ** (view.failures - 1)', 'exponential backoff'], ['AbortController', 'request timeout'], ["chainId === 'solana'", 'solana filter'],
      ['TOP_N = 10', 'top 10'], ['sort((a, b) => b.vol - a.vol)', 'volume order'], ['referrerPolicy', 'img referrer policy'],
      ["addEventListener('error'", 'letter tile fallback'], ['flash-up', 'value-change flash'], ['tween(', 'count-up'], ['view.data', 'last good data kept'],
    ];
    const missing = need.filter(([k]) => !s.includes(k)).map(([, d]) => d);
    return missing.length ? fail(`missing: ${missing.join(', ')}`) : ok(`${need.length} behaviours present`);
  },

  'repo-hygiene': async () => {
    const files = walk(ROOT, (p, e) => e.isDirectory() && ['node_modules', '.cache'].includes(e.name));
    const problems = [];
    const pat = new RegExp('\\b(?:' + ['cl' + 'aude', 'anthro' + 'pic', 'chat' + 'gpt', 'open' + 'ai', 'copi' + 'lot', 'co-authored' + '-by', 'generat' + 'ed (?:by|with)'].join('|') + ')\\b', 'i');
    const patCase = new RegExp('\\bA' + 'I\\b');
    for (const p of files) {
      const r = path.relative(ROOT, p).split(path.sep).join('/');
      if (/(^|\/)cl[a]ude\.md$/i.test(r) || /(^|\/)\.cl[a]ude\//i.test(r)) problems.push(`forbidden path ${r}`);
      if (/\.(md|html|css|js|mjs|json|svg|txt)$/.test(r) && r !== 'package-lock.json') {
        const t = fs.readFileSync(p, 'utf8');
        if (pat.test(t) || patCase.test(t)) problems.push(`attribution text in ${r}`);
      }
    }
    return problems.length ? fail(problems.join('; ')) : ok(`${files.length} project files scanned`);
  },

  'repo-files': async (ctx) => {
    const must = {
      'README.md': [/Mintr/, /img\.shields\.io/, /Solana/, /Contract address/i, /## Overview/, /## Features/, /## Links/],
      'docs/whitepaper.md': [/Vision/i, /Mission/i, /Tokenomics/i, /Phase 1/, /Phase 3/, /Team/i],
      LICENSE: [/MIT License/, /Copyright \(c\) 2026 Mintr/],
    };
    const problems = [];
    for (const [f, pats] of Object.entries(must)) {
      const p = path.join(ROOT, f);
      if (!fs.existsSync(p)) { problems.push(`${f} missing`); continue; }
      const t = fs.readFileSync(p, 'utf8');
      for (const re of pats) if (!re.test(t)) problems.push(`${f} lacks ${re}`);
      if (fs.existsSync(path.join(ctx.dist, f)) || fs.existsSync(path.join(ctx.dist, path.basename(f)))) problems.push(`${f} leaked into dist`);
    }
    return problems.length ? fail(problems.join('; ')) : ok('README, whitepaper, LICENSE present and not in dist');
  },

  'scanner-0x-policy': async () => {
    const hex = '0x' + 'ab12'.repeat(10);
    const other = '0x' + 'cd34'.repeat(10);
    const pass = scanAddresses(`value ${hex}`, new Set([hex])).length === 0;
    const catches = scanAddresses(`value ${other}`, new Set([hex])).length === 1;
    const plain = scanAddresses('plain text with no addresses 0x12', new Set()).length === 0;
    return pass && catches && plain ? ok('0x hex passes when registered, fails only when unregistered') : fail('0x handling wrong');
  },
};

export const hashFile = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
export const MARKET_FILES = ['assets/js/market.js', 'assets/js/motion.js', 'assets/js/copy.js'];
