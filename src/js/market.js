import { copyText, announce } from './copy.js';
import { reduced, tween } from './motion.js';

const BOOSTS_URL = document.body.dataset.boostsUrl;
const PAIRS_URL = document.body.dataset.pairsUrl;
const POLL_MS = 60000;
const BACKOFF_BASE_MS = 2000;
const TOP_N = 10;
const DASH = '—';

const rowsEl = document.getElementById('rows');
const tickerEl = document.getElementById('ticker');
const pillEl = document.getElementById('pill');
const stats = {
  count: document.querySelector('[data-stat="count"]'),
  vol: document.querySelector('[data-stat="vol"]'),
  liq: document.querySelector('[data-stat="liq"]'),
};

const view = { data: null, mode: 'volume', failures: 0, timer: 0, inflight: false, firstPaint: true };
const live = new Map();

const usd = (n) => {
  if (!Number.isFinite(n)) return DASH;
  const a = Math.abs(n);
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [v, s] of units) if (a >= v) return `$${(n / v).toFixed(2)}${s}`;
  return `$${n.toFixed(0)}`;
};
const price = (n) => {
  if (!Number.isFinite(n)) return DASH;
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  if (n === 0) return '$0';
  return `$${n.toFixed(Math.min(12, 2 - Math.floor(Math.log10(n))))}`;
};
const pct = (n) => (Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : DASH);
const whole = (n) => (Number.isFinite(n) ? String(Math.round(n)) : DASH);

async function getJSON(url, ms = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function load() {
  const boosts = await getJSON(BOOSTS_URL);
  const list = Array.isArray(boosts) ? boosts : [];
  const addrs = [...new Set(list.filter((b) => b && b.chainId === 'solana' && typeof b.tokenAddress === 'string').map((b) => b.tokenAddress))].slice(0, 30);
  if (!addrs.length) throw new Error('no solana entries');
  const pairs = await getJSON(PAIRS_URL.replace('{addresses}', addrs.join(',')));
  const wanted = new Set(addrs);
  const best = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const base = p && p.baseToken;
    if (!base || p.chainId !== 'solana' || !wanted.has(base.address)) continue;
    const liq = Number(p.liquidity && p.liquidity.usd) || 0;
    const prev = best.get(base.address);
    if (!prev || liq > prev.liq) {
      best.set(base.address, {
        addr: base.address,
        symbol: String(base.symbol || '?'),
        name: String(base.name || ''),
        price: Number(p.priceUsd),
        chg: Number(p.priceChange && p.priceChange.h24),
        vol: Number(p.volume && p.volume.h24),
        liq,
        img: p.info && typeof p.info.imageUrl === 'string' && p.info.imageUrl.startsWith('https://') ? p.info.imageUrl : '',
      });
    }
  }
  const top = [...best.values()].filter((r) => Number.isFinite(r.vol)).sort((a, b) => b.vol - a.vol).slice(0, TOP_N);
  if (!top.length) throw new Error('no pairs');
  return top;
}

/* ---------- status ---------- */
const PILL = { live: 'Live', loading: 'Syncing', sync: 'Refreshing', retry: 'Reconnecting', error: 'Source down' };
function setPill(state) {
  pillEl.dataset.state = state;
  pillEl.querySelector('.pill__t').textContent = PILL[state];
}

/* ---------- numbers ---------- */
function setNum(el, value, fmt) {
  const prev = el._v;
  el._v = value;
  if (!Number.isFinite(value)) { el.textContent = DASH; return; }
  if (el._cancel) el._cancel();
  if (prev === undefined) {
    el._cancel = tween(0, value, 800, (v) => { el.textContent = fmt(v); });
    return;
  }
  if (prev === value) { el.textContent = fmt(value); return; }
  el._cancel = tween(Number.isFinite(prev) ? prev : value, value, 600, (v) => { el.textContent = fmt(v); });
  if (!reduced()) {
    const cls = value > prev ? 'flash-up' : 'flash-down';
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth;
    el.classList.add(cls);
  }
}

function setChg(el, value) {
  setNum(el, value, pct);
  el.classList.toggle('up', value >= 0);
  el.classList.toggle('down', value < 0);
}

/* ---------- rows ---------- */
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function hueOf(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 5;
}

function makeTile(r) {
  const tile = document.createElement('span');
  tile.className = 'logo-tile';
  tile.dataset.hue = String(hueOf(r.symbol));
  const letter = (r.symbol.trim()[0] || '?').toUpperCase();
  const fall = () => { tile.textContent = letter; };
  if (r.img) {
    const img = new Image();
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => { img.remove(); fall(); }, { once: true });
    img.src = r.img;
    tile.appendChild(img);
  } else fall();
  return tile;
}

function makeRow(r) {
  const row = document.createElement('div');
  row.className = 'row row--live';
  row.setAttribute('role', 'row');
  row.setAttribute('data-spot', '');
  row.innerHTML = `
    <div class="c c-rank" role="cell"></div>
    <div class="c c-tok" role="cell"><span class="tile-slot"></span><span class="tokname"><b></b><span></span></span></div>
    <div class="c c-price" role="cell" data-label="Price"></div>
    <div class="c c-chg" role="cell" data-label="24h"></div>
    <div class="c c-vol" role="cell" data-label="Volume"></div>
    <div class="c c-liq" role="cell" data-label="Liquidity"></div>
    <div class="c c-act" role="cell"><button class="copy" type="button">${COPY_ICON}</button></div>`;
  row.querySelector('.tile-slot').replaceWith(makeTile(r));
  row.querySelector('.tokname b').textContent = r.symbol;
  row.querySelector('.tokname span').textContent = r.name || r.symbol;
  const btn = row.querySelector('.copy');
  btn.setAttribute('aria-label', `Copy address for ${r.symbol}`);
  btn.addEventListener('click', async () => {
    const ok = await copyText(row._addr);
    announce(ok ? `Address for ${r.symbol} copied` : 'Copy failed');
    if (!ok) return;
    btn.innerHTML = CHECK_ICON;
    btn.classList.add('is-done');
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { btn.innerHTML = COPY_ICON; btn.classList.remove('is-done'); }, 1500);
  });
  return row;
}

function sorted(data) {
  const copy = [...data];
  if (view.mode === 'movers') copy.sort((a, b) => (b.chg || -Infinity) - (a.chg || -Infinity));
  else if (view.mode === 'liquidity') copy.sort((a, b) => b.liq - a.liq);
  else copy.sort((a, b) => b.vol - a.vol);
  return copy;
}

function clearSkeleton() {
  const skels = rowsEl.querySelectorAll('.skel-row');
  skels.forEach((s) => s.classList.add('is-out'));
  const done = () => skels.forEach((s) => s.remove());
  if (reduced() || !skels.length) done(); else setTimeout(done, 280);
}

function render() {
  const data = view.data;
  if (!data) return;
  const err = rowsEl.querySelector('.board__err');
  if (err) err.remove();
  const order = sorted(data);
  const keep = new Set(order.map((r) => r.addr));
  for (const [addr, row] of live) if (!keep.has(addr)) { row.remove(); live.delete(addr); }
  const fresh = [];
  order.forEach((r, i) => {
    let row = live.get(r.addr);
    if (!row) { row = makeRow(r); live.set(r.addr, row); fresh.push(row); }
    row._addr = r.addr;
    rowsEl.appendChild(row);
    row.querySelector('.c-rank').textContent = String(i + 1);
    setNum(row.querySelector('.c-price'), r.price, price);
    setChg(row.querySelector('.c-chg'), r.chg);
    setNum(row.querySelector('.c-vol'), r.vol, usd);
    setNum(row.querySelector('.c-liq'), r.liq, usd);
  });
  if (view.firstPaint) { clearSkeleton(); view.firstPaint = false; }
  fresh.forEach((row, i) => {
    const show = () => row.classList.add('is-in');
    if (reduced()) show(); else setTimeout(() => requestAnimationFrame(show), 120 + i * 55);
  });
  renderStats(data);
  renderTicker(order);
}

function renderStats(data) {
  setNum(stats.count, data.length, whole);
  setNum(stats.vol, data.reduce((s, r) => s + (r.vol || 0), 0), usd);
  setNum(stats.liq, data.reduce((s, r) => s + (r.liq || 0), 0), usd);
}

function tickHTML(r) {
  const up = r.chg >= 0;
  return `<b></b><span class="p"></span><span class="d ${up ? 'up' : 'down'}"></span>`;
}

function fillTick(el, r) {
  el.querySelector('b').textContent = r.symbol;
  el.querySelector('.p').textContent = price(r.price);
  const d = el.querySelector('.d');
  d.textContent = Number.isFinite(r.chg) ? `${r.chg >= 0 ? '▲' : '▼'} ${pct(Math.abs(r.chg)).replace('+', '')}` : DASH;
  d.className = `d ${r.chg >= 0 ? 'up' : 'down'}`;
}

function renderTicker(order) {
  const sig = order.map((r) => r.addr).join('|');
  if (tickerEl._sig !== sig) {
    tickerEl._sig = sig;
    tickerEl.textContent = '';
    for (let copy = 0; copy < 2; copy++) {
      const set = document.createElement('div');
      set.className = 'ticker__set';
      if (copy) set.setAttribute('aria-hidden', 'true');
      for (const r of order) {
        const t = document.createElement('span');
        t.className = 'tick';
        t.innerHTML = tickHTML(r);
        t.dataset.addr = r.addr;
        set.appendChild(t);
      }
      tickerEl.appendChild(set);
    }
  }
  const byAddr = new Map(order.map((r) => [r.addr, r]));
  tickerEl.querySelectorAll('.tick').forEach((t) => fillTick(t, byAddr.get(t.dataset.addr)));
}

function showFailure() {
  if (view.data) return;
  const skels = rowsEl.querySelectorAll('.skel-row');
  skels.forEach((s) => s.remove());
  if (!rowsEl.querySelector('.board__err')) {
    const box = document.createElement('div');
    box.className = 'board__err';
    box.innerHTML = `<b>${DASH}</b><span>The market source did not answer. Retrying on its own.</span>`;
    rowsEl.appendChild(box);
  }
  for (const k of Object.keys(stats)) stats[k].textContent = DASH;
  tickerEl.textContent = '';
  const t = document.createElement('div');
  t.className = 'ticker__set';
  t.innerHTML = `<span class="tick">${DASH}</span>`;
  tickerEl.appendChild(t);
  tickerEl._sig = '';
}

/* ---------- polling ---------- */
function schedule(ms) {
  clearTimeout(view.timer);
  view.timer = 0;
  if (document.hidden) return;
  view.timer = setTimeout(tick, ms);
}

async function tick() {
  if (view.inflight) return;
  view.inflight = true;
  clearTimeout(view.timer);
  setPill(view.data ? 'sync' : 'loading');
  try {
    view.data = await load();
    view.failures = 0;
    render();
    setPill('live');
    schedule(POLL_MS);
  } catch {
    view.failures += 1;
    setPill(view.data ? 'retry' : 'error');
    showFailure();
    const wait = Math.min(POLL_MS, BACKOFF_BASE_MS * 2 ** (view.failures - 1));
    schedule(wait * (0.85 + Math.random() * 0.3));
  } finally {
    view.inflight = false;
  }
}

export function initMarket() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      view.mode = tab.dataset.mode;
      document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      render();
    });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(view.timer); view.timer = 0; }
    else tick();
  });
  if (!document.hidden) tick();
}
