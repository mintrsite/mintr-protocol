import fs from 'node:fs';
import path from 'node:path';
import { build } from './build.mjs';
import { loadRegister, isStated, fixtureAddress } from './lib/register.mjs';
import { CHECKS, ROOT, hashFile, MARKET_FILES, scanAddresses, DATE_PATTERNS } from './lib/checks.mjs';

const DIST = path.join(ROOT, 'dist');
const CACHE = path.join(ROOT, '.cache');
const REG = path.join(ROOT, 'src', 'register.json');

let total = 0;
let failed = 0;
const line = (good, name, msg) => {
  total++;
  if (!good) failed++;
  console.log(`${good ? 'PASS' : 'FAIL'}  ${name}${msg ? ' - ' + msg : ''}`);
};

async function run(group, ctx, names) {
  console.log(`\n[${group}]`);
  for (const n of names) {
    let r;
    try { r = await CHECKS[n](ctx); } catch (e) { r = { ok: false, msg: `threw ${e.message}` }; }
    line(r.ok, n, r.msg);
  }
}

const ctxFor = (dist, records) => ({ dist, records });
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const copyDist = (to) => { fs.rmSync(to, { recursive: true, force: true }); fs.cpSync(DIST, to, { recursive: true }); return to; };

if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('dist/ is missing, run npm run build first'); process.exit(1); }
fs.rmSync(CACHE, { recursive: true, force: true });
fs.mkdirSync(CACHE, { recursive: true });

const actual = loadRegister(REG).records;

/* ---------------- 1. the shipped dist against the real register ---------------- */
await run(`dist (ca=${actual.ca.state}, github=${actual.github.state})`, ctxFor(DIST, actual), Object.keys(CHECKS));

/* ---------------- 2. both gate branches, built from fixtures ---------------- */
const base = readJSON(REG);
const caValue = fixtureAddress('mintr-fixture-ca');
const variants = {
  'ca-stated+github-stated': { ca: { state: 'stated', label: base.records.ca.label, value: caValue, source: 'fixture', scope: 'batch-level', checked: 'fixture' }, github: { state: 'stated', label: 'GitHub', url: 'https://github.com/mintr-site', source: 'fixture', scope: 'batch-level', checked: 'fixture' } },
  'ca-unconfirmed': { ca: { state: 'unconfirmed', label: base.records.ca.label, source: 'fixture', scope: 'batch-level', checked: 'fixture' } },
  'ca-absent': {},
};
const BRANCH = ['register-shape', 'ca-slot', 'link-rule', 'social-always-top-right', 'address-scan', 'market-independent-of-ca', 'no-dates', 'colour-literals-confined'];
const builds = {};
for (const [name, patch] of Object.entries(variants)) {
  const reg = structuredClone(base);
  Object.assign(reg.records, patch);
  const regFile = path.join(CACHE, `${name}.register.json`);
  fs.writeFileSync(regFile, JSON.stringify(reg));
  const out = path.join(CACHE, name);
  await build({ registerPath: regFile, out });
  builds[name] = { out, records: reg.records };
  await run(`branch ${name}`, ctxFor(out, reg.records), BRANCH);
}

console.log('\n[branch isolation]');
{
  const outs = Object.values(builds).map((b) => b.out);
  const same = MARKET_FILES.every((f) => new Set(outs.map((o) => hashFile(path.join(o, f)))).size === 1);
  line(same, 'market assets identical across CA states', MARKET_FILES.join(', '));
  const attr = (o) => (fs.readFileSync(path.join(o, 'index.html'), 'utf8').match(/data-(?:boosts|pairs)-url="[^"]*"/g) || []).join('|');
  line(new Set(outs.map(attr)).size === 1, 'market source attributes identical across CA states');
  const stated = builds['ca-stated+github-stated'];
  const h = fs.readFileSync(path.join(stated.out, 'index.html'), 'utf8');
  line(h.includes(caValue) && /<button[^>]*data-slot="contract"/.test(h), 'stated branch renders the full address in a copy button');
  const absent = fs.readFileSync(path.join(builds['ca-absent'].out, 'index.html'), 'utf8');
  line(!/<button[^>]*data-slot="contract"/.test(absent) && !scanAddresses(absent, new Set()).length, 'absent branch renders an inert slot with no address-shaped string');
  const unconf = fs.readFileSync(path.join(builds['ca-unconfirmed'].out, 'index.html'), 'utf8');
  line(!/<button[^>]*data-slot="contract"/.test(unconf), 'unconfirmed branch also inert');
}

/* ---------------- 3. mutation harness: anchors read the live record, never assume its state ---------------- */
console.log('\n[mutation harness] each mutation must make a gate fail');
let n = 0;
async function mutate(name, gate, apply, { records = actual } = {}) {
  const dir = copyDist(path.join(CACHE, `mut-${++n}`));
  const recs = structuredClone(records);
  apply({ dir, recs, file: (f) => path.join(dir, f) });
  const r = await CHECKS[gate](ctxFor(dir, recs));
  line(!r.ok, `caught: ${name}`, `${gate} -> ${r.ok ? 'MISSED' : r.msg.slice(0, 90)}`);
}
const edit = (file, fn) => fs.writeFileSync(file, fn(fs.readFileSync(file, 'utf8')));

await mutate('inert record gains a value', 'register-shape', ({ recs }) => {
  if (isStated(recs.ca)) recs.ca.state = 'unconfirmed';
  recs.ca.value = fixtureAddress('mutation');
});
await mutate('inert record gains a url', 'register-shape', ({ recs }) => {
  recs.github.state = 'unconfirmed';
  recs.github.url = 'https://github.com/mutant';
});
await mutate('github icon disagrees with register (href toggled)', 'link-rule', ({ file, recs }) => {
  const stated = isStated(recs.github);
  edit(file('index.html'), (h) => h.replace(/<(a|span)\b([^>]*data-social="github"[^>]*)>/, (m, tag, attrs) =>
    stated ? `<span ${attrs.replace(/\bhref="[^"]*"/, '')}>` : `<a href="https://github.com/mutant" ${attrs}>`));
});
await mutate('x icon disagrees with register (href toggled)', 'link-rule', ({ file, recs }) => {
  const stated = isStated(recs.x);
  edit(file('index.html'), (h) => h.replace(/<(a|span)\b([^>]*data-social="x"[^>]*)>/, (m, tag, attrs) =>
    stated ? `<span ${attrs.replace(/\bhref="[^"]*"/, '')}>` : `<a href="https://x.com/mutant" ${attrs}>`));
});
await mutate('stray link to an unregistered host', 'link-rule', ({ file }) => edit(file('index.html'), (h) => h.replace('</main>', '<a href="https://example.com/x">x</a></main>')));
await mutate('ca slot disagrees with register', 'ca-slot', ({ file, recs }) => {
  const stated = isStated(recs.ca);
  edit(file('index.html'), (h) => stated
    ? h.replace(/<span class="ca__addr">[^<]*<\/span>/, '<span class="ca__addr">pending</span>')
    : h.replace('>pending</span>', `>${fixtureAddress('leak')}</span>`));
});
await mutate('ca slot loses aria-disabled or button semantics', 'ca-slot', ({ file, recs }) => {
  const stated = isStated(recs.ca);
  edit(file('index.html'), (h) => stated ? h.replace('<button type="button" class="ca__row"', '<div class="ca__row"') : h.replace('aria-disabled="true"', ''));
});
await mutate('date injected into page copy', 'no-dates', ({ file }) => edit(file('index.html'), (h) => h.replace('Live board', 'Live board, as of today')));
await mutate('iso date in aria-label', 'no-dates', ({ file }) => edit(file('index.html'), (h) => h.replace('aria-label="Sections"', 'aria-label="Sections 2026-10-26"')));
await mutate('clock string in script', 'no-dates', ({ file }) => fs.appendFileSync(file('assets/js/app.js'), "\nconst t = '12:30';\n"));
await mutate('hex literal outside tokens', 'colour-literals-confined', ({ file }) => fs.appendFileSync(file('assets/css/site.css'), '\na { color: #ff00aa; }\n'));
await mutate('rgb literal in script', 'colour-literals-confined', ({ file }) => fs.appendFileSync(file('assets/js/motion.js'), "\nconst c = 'rgb(1,2,3)';\n"));
await mutate('ch unit in css', 'no-ch-units', ({ file }) => fs.appendFileSync(file('assets/css/site.css'), '\n.x { width: 20ch; }\n'));
await mutate('unregistered base58 address', 'address-scan', ({ file }) => edit(file('index.html'), (h) => h.replace('</main>', `<p>${fixtureAddress('stray')}</p></main>`)));
await mutate('unregistered 0x address', 'address-scan', ({ file }) => edit(file('index.html'), (h) => h.replace('</main>', `<p>0x${'9f'.repeat(20)}</p></main>`)));
await mutate('favicon with double-hyphen comment', 'favicon', ({ file }) => edit(file('favicon.svg'), (s) => s.replace('<rect', '<!-- a -- b --><rect')));
await mutate('favicon wrong size', 'favicon', ({ file }) => edit(file('favicon.svg'), (s) => s.replace('viewBox="0 0 32 32"', 'viewBox="0 0 16 16"')));
await mutate('logo file missing from dist', 'logo-in-dist', ({ file }) => fs.rmSync(file('assets/mark-720.png')));
await mutate('logo path made absolute', 'logo-in-dist', ({ file }) => edit(file('index.html'), (h) => h.replace('src="assets/mark-160.png"', 'src="/assets/mark-160.png"')));
await mutate('market module reads CA state', 'market-independent-of-ca', ({ file }) => fs.appendFileSync(file('assets/js/market.js'), "\nconst gate = document.querySelector('[data-slot=\"contract\"]');\n"));
await mutate('reduced-motion block removed', 'reduced-motion', ({ file }) => edit(file('assets/css/site.css'), (s) => s.replace('prefers-reduced-motion: reduce', 'prefers-color-scheme: dark')));
await mutate('polling interval changed', 'market-behaviour', ({ file }) => edit(file('assets/js/market.js'), (s) => s.replace('POLL_MS = 60000', 'POLL_MS = 5000')));
await mutate('inline script added', 'csp-and-scripts', ({ file }) => edit(file('index.html'), (h) => h.replace('</body>', '<script>alert(1)</script></body>')));
await mutate('palette token drifts from its source pixel', 'palette-provenance', ({ file }) => edit(file('assets/css/tokens.css'), (s) => s.replace('--gold: #f3da38', '--gold: #f3da39')));
await mutate('social icons hidden on mobile', 'social-always-top-right', ({ file }) => fs.appendFileSync(file('assets/css/site.css'), '\n.social { display: none; }\n'));
await mutate('register shipped in dist', 'no-dates', ({ file }) => fs.writeFileSync(file('register.json'), '{}'));

/* positive control: a registered 0x value must NOT be rejected */
{
  const hex = `0x${'1a2b'.repeat(10)}`;
  const dir = copyDist(path.join(CACHE, 'control-0x'));
  edit(path.join(dir, 'index.html'), (h) => h.replace('</main>', `<p>${hex}</p></main>`));
  const recs = structuredClone(actual);
  recs.rpc = { ...recs.rpc, state: 'stated', value: hex };
  const r = await CHECKS['address-scan'](ctxFor(dir, recs));
  line(r.ok, 'control: 0x value matching a stated record is accepted', r.msg.slice(0, 80));
}
line(DATE_PATTERNS.length >= 8, 'date detector has full pattern set', `${DATE_PATTERNS.length} patterns`);

fs.rmSync(CACHE, { recursive: true, force: true });
console.log(`\ngates: ${total - failed}/${total} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
