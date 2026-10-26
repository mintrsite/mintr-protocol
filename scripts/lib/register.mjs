import fs from 'node:fs';
import crypto from 'node:crypto';

export const STATES = ['stated', 'absent', 'unconfirmed'];
export const INERT_KEYS = ['state', 'label', 'source', 'scope', 'checked'];
export const BASE58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
export const HEX40 = /0x[0-9a-fA-F]{40}/g;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function loadRegister(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export const isStated = (rec) => !!rec && rec.state === 'stated';

/* Handle is derived from the stored URL, never stored itself. */
export function handleFromUrl(url) {
  const seg = new URL(url).pathname.split('/').filter(Boolean)[0];
  return seg ? `@${seg}` : '';
}

export function looksLikeAddress(s) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) || /^0x[0-9a-fA-F]{40}$/.test(s);
}

export function base58(bytes) {
  let n = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  return out;
}

/* Deterministic fixture address; only ever used by gate fixtures, never shipped. */
export function fixtureAddress(seed) {
  return base58(crypto.createHash('sha256').update(seed).digest());
}

export function parseTokens(css) {
  const out = {};
  for (const m of css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6});\s*\/\* px (.+?) (\d+),(\d+) \*\//g)) {
    out[m[1]] = { hex: m[2].toLowerCase(), file: m[3], x: Number(m[4]), y: Number(m[5]) };
  }
  return out;
}
