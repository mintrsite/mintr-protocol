import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { loadRegister, isStated, handleFromUrl, looksLikeAddress, parseTokens } from './lib/register.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const LOGO_CUTOUT = path.join(ROOT, 'brand', 'LOGO MINTR PNG...png');
const BANNER = path.join(ROOT, 'reference', 'SAMPUL MINTR JPG.jpg.jpeg');
const POSTER = path.join(ROOT, 'reference', 'MINTR 1.jpg.jpeg');

const X_PATH = 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';
const GH_PATH = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z';
const xSvg = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${X_PATH}"/></svg>`;
const ghSvg = `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${GH_PATH}"/></svg>`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function renderCaSlot(rec) {
  if (isStated(rec)) {
    return `<div class="ca" data-slot-wrap><div class="ca__in wrap"><span class="ca__label">${esc(rec.label)}</span>` +
      `<button type="button" class="ca__row" data-slot="contract" data-state="stated" aria-label="Copy contract address">` +
      `<span class="ca__addr">${esc(rec.value)}</span><span class="ca__hint">Tap to copy</span></button></div></div>`;
  }
  return `<div class="ca" data-slot-wrap><div class="ca__in wrap"><span class="ca__label">${esc(rec.label)}</span>` +
    `<div class="ca__row" data-slot="contract" data-state="${esc(rec.state)}" aria-disabled="true">` +
    `<span class="ca__addr ca__addr--pending">pending</span></div></div></div>`;
}

function renderSocial(x, gh) {
  const a = isStated(x)
    ? `<a class="social__btn" data-social="x" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer" aria-label="Mintr on X, ${esc(handleFromUrl(x.url))}">${xSvg}</a>`
    : `<span class="social__btn social__btn--inert" data-social="x" role="img" aria-label="X, pending">${xSvg}</span>`;
  const b = isStated(gh)
    ? `<a class="social__btn" data-social="github" href="${esc(gh.url)}" target="_blank" rel="noopener noreferrer" aria-label="Mintr on GitHub, ${esc(handleFromUrl(gh.url))}">${ghSvg}</a>`
    : `<span class="social__btn social__btn--inert" data-social="github" role="img" aria-label="GitHub, pending">${ghSvg}</span>`;
  return `<div class="social" data-social-group>${a}${b}</div>`;
}

function renderChips(x, gh) {
  const chip = (rec, key, svg, name) => isStated(rec)
    ? `<a class="chip" data-chip="${key}" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer">${svg}<span>${esc(handleFromUrl(rec.url))}</span></a>`
    : `<span class="chip chip--inert" data-chip="${key}">${svg}<span>${name}</span><small>pending</small></span>`;
  return `<div class="chips">${chip(x, 'x', xSvg, 'X')}${chip(gh, 'github', ghSvg, 'GitHub')}</div>`;
}

function skeletonRows() {
  const row = `<div class="row skel-row" role="row" aria-hidden="true"><div class="c c-rank"><span class="skel skel--s"></span></div><div class="c c-tok"><span class="skel skel--tile"></span><span class="tokname" style-free><span class="skel skel--l"></span><span class="skel skel--s"></span></span></div><div class="c c-price"><span class="skel skel--r"></span></div><div class="c c-chg"><span class="skel skel--r"></span></div><div class="c c-vol"><span class="skel skel--r"></span></div><div class="c c-liq"><span class="skel skel--r"></span></div><div class="c c-act"></div></div>`.replace(' style-free', '');
  return row.repeat(10);
}

async function alphaBox(raw, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (raw[(y * w + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

async function buildImages(out, tokens) {
  const assets = path.join(out, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  const src = sharp(LOGO_CUTOUT).ensureAlpha();
  const { data, info } = await src.clone().raw().toBuffer({ resolveWithObject: true });
  if (!data.some((v, i) => i % 4 === 3 && v < 255)) throw new Error('logo cutout has no transparency');
  const box = await alphaBox(data, info.width, info.height);
  /* Source has pure-black transparent regions; libvips premultiplies alpha before resampling,
     so no dark fringe is blended into the edge. gates.mjs measures the result. */
  const trimmed = () => sharp(LOGO_CUTOUT).ensureAlpha().extract(box);
  const sizes = {};
  for (const [name, opts] of [['mark-160.png', { height: 72 }], ['mark-720.png', { width: 720 }]]) {
    const r = await trimmed().resize({ ...opts, kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
    fs.writeFileSync(path.join(assets, name), r.data);
    sizes[name] = [r.info.width, r.info.height];
  }
  const ink = hexToRgb(tokens['ink-0'].hex);
  for (const [name, size, flat] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['apple-touch-icon.png', 180, true]]) {
    const inner = Math.round(size * 0.78);
    const mark = await trimmed().resize({ width: inner, height: inner, fit: 'inside', kernel: 'lanczos3' }).png().toBuffer();
    let img = sharp({ create: { width: size, height: size, channels: 4, background: { r: ink[0], g: ink[1], b: ink[2], alpha: flat ? 1 : 0 } } })
      .composite([{ input: mark, gravity: 'centre' }]);
    fs.writeFileSync(path.join(assets, name), await img.png({ compressionLevel: 9 }).toBuffer());
  }
  await sharp(BANNER).resize({ width: 1500 }).webp({ quality: 82 }).toFile(path.join(assets, 'hero.webp'));
  await sharp(POSTER).resize({ width: 1200 }).jpeg({ quality: 84, mozjpeg: true }).toFile(path.join(assets, 'og.jpg'));
  return { sizes, box };
}

/* 32x32 favicon traced from the real pixel grid of the cutout, snapped to token colours. */
async function buildFavicon(out, tokens) {
  const { data, info } = await sharp(LOGO_CUTOUT).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const box = await alphaBox(data, info.width, info.height);
  const side = Math.max(box.width, box.height);
  const pad = Math.round(side * 0.04);
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const half = Math.round(side / 2) + pad;
  const left = Math.max(0, Math.round(cx - half));
  const top = Math.max(0, Math.round(cy - half));
  const edge = Math.min(half * 2, info.width - left, info.height - top);
  const px = await sharp(LOGO_CUTOUT).ensureAlpha().extract({ left, top, width: edge, height: edge })
    .resize(32, 32, { kernel: 'nearest' }).raw().toBuffer();
  const palette = Object.values(tokens).map((t) => ({ hex: t.hex, rgb: hexToRgb(t.hex) }));
  const grid = [];
  for (let y = 0; y < 32; y++) {
    grid.push([]);
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      if (px[i + 3] < 128) { grid[y].push(null); continue; }
      let best = palette[0], bd = Infinity;
      for (const p of palette) {
        const d = (p.rgb[0] - px[i]) ** 2 + (p.rgb[1] - px[i + 1]) ** 2 + (p.rgb[2] - px[i + 2]) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      grid[y].push(best.hex);
    }
  }
  const rects = [];
  const open = new Map();
  for (let y = 0; y <= 32; y++) {
    const runs = new Map();
    if (y < 32) {
      for (let x = 0; x < 32;) {
        const c = grid[y][x];
        if (!c) { x++; continue; }
        let e = x; while (e < 32 && grid[y][e] === c) e++;
        runs.set(`${x}:${e - x}:${c}`, { x, w: e - x, c });
        x = e;
      }
    }
    for (const [k, r] of open) if (!runs.has(k)) { rects.push(r); open.delete(k); }
    for (const [k, r] of runs) { if (open.has(k)) open.get(k).h++; else open.set(k, { ...r, y, h: 1 }); }
  }
  const body = rects.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.c}"/>`).join('');
  fs.writeFileSync(path.join(out, 'favicon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">${body}</svg>\n`);
  return rects.length;
}

export async function build({ registerPath = path.join(SRC, 'register.json'), out = path.join(ROOT, 'dist') } = {}) {
  const reg = loadRegister(registerPath).records;
  for (const key of ['chain', 'ca', 'x', 'github', 'market']) if (!reg[key]) throw new Error(`register is missing "${key}"`);
  if (isStated(reg.ca) && !looksLikeAddress(reg.ca.value)) throw new Error('stated contract address is not address-shaped');
  if (!isStated(reg.market)) throw new Error('market source must be stated');

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'assets', 'css'), { recursive: true });
  fs.mkdirSync(path.join(out, 'assets', 'js'), { recursive: true });

  const tokensCss = fs.readFileSync(path.join(SRC, 'css', 'tokens.css'), 'utf8');
  const tokens = parseTokens(tokensCss);
  if (Object.keys(tokens).length < 10) throw new Error('palette provenance notes missing in tokens.css');

  const { sizes } = await buildImages(out, tokens);
  const faviconRects = await buildFavicon(out, tokens);

  for (const f of fs.readdirSync(path.join(SRC, 'css'))) fs.copyFileSync(path.join(SRC, 'css', f), path.join(out, 'assets', 'css', f));
  for (const f of fs.readdirSync(path.join(SRC, 'js'))) fs.copyFileSync(path.join(SRC, 'js', f), path.join(out, 'assets', 'js', f));

  const [mw, mh] = sizes['mark-160.png'];
  const [bw, bh] = sizes['mark-720.png'];
  const html = fs.readFileSync(path.join(SRC, 'index.template.html'), 'utf8')
    .replaceAll('{{MARK_W}}', mw).replaceAll('{{MARK_H}}', mh)
    .replaceAll('{{MARK_BIG_W}}', bw).replaceAll('{{MARK_BIG_H}}', bh)
    .replace('{{BOOSTS_URL}}', esc(reg.market.url))
    .replace('{{PAIRS_URL}}', esc(reg.market.pairsUrl))
    .replace('{{CHAIN}}', esc(reg.chain.value))
    .replace('{{SOCIAL}}', renderSocial(reg.x, reg.github))
    .replace('{{CA_SLOT}}', renderCaSlot(reg.ca))
    .replace('{{SKELETON_ROWS}}', skeletonRows())
    .replace('{{FOOT_CHIPS}}', renderChips(reg.x, reg.github));
  if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error('unreplaced template token');
  fs.writeFileSync(path.join(out, 'index.html'), html);
  fs.writeFileSync(path.join(out, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/assets/*\n  Cache-Control: public, max-age=3600\n');
  fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  return { out, faviconRects, sizes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? path.resolve(process.argv[i + 1]) : undefined; };
  build({ registerPath: arg('--register'), out: arg('--out') }).then((r) => {
    console.log(`built ${path.relative(ROOT, r.out) || '.'} | favicon rects ${r.faviconRects} | marks ${JSON.stringify(r.sizes)}`);
  }).catch((e) => { console.error('build failed:', e.message); process.exit(1); });
}
