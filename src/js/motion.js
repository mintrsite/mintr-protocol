export const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => reducedQuery.matches;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* Damped spring, semi-implicit Euler with substeps. Offset x runs 1 -> 0. */
const STIFFNESS = 170;
const DAMPING = 19;
const active = new Set();
let raf = 0;
let last = 0;

function paint(s) {
  const el = s.el;
  el.style.transform = `translate3d(0, ${(s.x * 34).toFixed(2)}px, 0) scale(${(1 - s.x * 0.035).toFixed(4)})`;
  el.style.opacity = String(clamp(1 - s.x * 1.1, 0, 1));
}

function settle(s) {
  s.el.style.transform = '';
  s.el.style.opacity = '';
  s.el.classList.add('rv-done');
  active.delete(s);
}

function frame(now) {
  const dt = Math.min(0.032, (now - last) / 1000 || 0.016);
  last = now;
  const steps = 3;
  const h = dt / steps;
  for (const s of [...active]) {
    for (let i = 0; i < steps; i++) {
      s.v += (-STIFFNESS * s.x - DAMPING * s.v) * h;
      s.x += s.v * h;
    }
    if (Math.abs(s.x) < 0.0015 && Math.abs(s.v) < 0.01) settle(s);
    else paint(s);
  }
  raf = active.size ? requestAnimationFrame(frame) : 0;
}

function start(el, delay) {
  const s = { el, x: 1, v: 0 };
  paint(s);
  setTimeout(() => {
    active.add(s);
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }, delay);
}

export function initReveal() {
  const items = document.querySelectorAll('.rv');
  if (reduced() || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('rv-done'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    let n = 0;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      start(e.target, n++ * 80);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  items.forEach((el) => io.observe(el));
}

export function initProgress() {
  const bar = document.querySelector('.progress i');
  if (!bar) return;
  let queued = false;
  const update = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? clamp(scrollY / max, 0, 1) : 0})`;
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  addEventListener('resize', update);
  update();
}

export function initSpotlight() {
  document.addEventListener('pointermove', (e) => {
    const t = e.target instanceof Element ? e.target.closest('[data-spot]') : null;
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', `${e.clientX - r.left}px`);
    t.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

export function initParallax() {
  if (reduced()) return;
  const hero = document.querySelector('.hero');
  const layers = [...hero.querySelectorAll('[data-depth]')];
  const bill = document.querySelector('[data-parallax]');
  let px = 0, py = 0, tx = 0, ty = 0, running = false;
  if (window.matchMedia('(pointer: fine)').matches) {
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
      kick();
    }, { passive: true });
    hero.addEventListener('pointerleave', () => { tx = 0; ty = 0; kick(); });
  }
  addEventListener('scroll', kick, { passive: true });
  function kick() { if (!running) { running = true; requestAnimationFrame(tick); } }
  function tick() {
    px += (tx - px) * 0.08;
    py += (ty - py) * 0.08;
    const sy = scrollY;
    for (const el of layers) {
      const d = Number(el.dataset.depth);
      el.style.translate = `${(px * d * 18).toFixed(2)}px ${(py * d * 12 - sy * d * 0.1).toFixed(2)}px`;
    }
    if (bill) {
      const r = bill.parentElement.getBoundingClientRect();
      const mid = (r.top + r.height / 2 - innerHeight / 2) / innerHeight;
      bill.style.transform = `translate3d(0, ${(mid * -40).toFixed(2)}px, 0) scale(1.12)`;
    }
    running = Math.abs(tx - px) > 0.001 || Math.abs(ty - py) > 0.001;
    if (running) requestAnimationFrame(tick);
  }
  kick();
}

/* Gradient mesh: soft additive blobs coloured from the CSS tokens. */
export function initMesh() {
  const canvas = document.querySelector('.hero__mesh');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const pick = (n) => css.getPropertyValue(n).trim();
  const blobs = [
    { c: pick('--amber'), fx: 0.00031, fy: 0.00023, ph: 0.0, r: 0.55 },
    { c: pick('--gold'), fx: 0.00027, fy: 0.00035, ph: 1.7, r: 0.38 },
    { c: pick('--teal-deep'), fx: 0.00022, fy: 0.00029, ph: 3.1, r: 0.6 },
    { c: pick('--umber'), fx: 0.00036, fy: 0.00021, ph: 4.4, r: 0.5 },
    { c: pick('--cyan'), fx: 0.00019, fy: 0.00033, ph: 5.6, r: 0.3 },
  ];
  const ink = pick('--ink-0');
  let w = 0, h = 0, raf = 0, visible = true;
  function size() {
    const r = canvas.getBoundingClientRect();
    w = canvas.width = Math.max(2, Math.round(r.width / 3));
    h = canvas.height = Math.max(2, Math.round(r.height / 3));
  }
  function draw(t) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = ink;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (const b of blobs) {
      const x = w * (0.5 + 0.42 * Math.sin(t * b.fx + b.ph));
      const y = h * (0.5 + 0.38 * Math.cos(t * b.fy + b.ph * 1.3));
      const rad = Math.max(w, h) * b.r;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, b.c);
      g.addColorStop(1, ink);
      ctx.globalAlpha = 0.17;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalAlpha = 1;
  }
  function loop(t) {
    raf = 0;
    if (!visible || document.hidden) return;
    draw(t);
    raf = requestAnimationFrame(loop);
  }
  const go = () => { if (!raf && !reduced()) raf = requestAnimationFrame(loop); };
  size();
  draw(4000);
  addEventListener('resize', () => { size(); draw(4000); });
  if (reduced()) return;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; go(); }).observe(canvas);
  document.addEventListener('visibilitychange', go);
  go();
}

/* Number tween with ease-out; returns a cancel handle. */
export function tween(from, to, ms, onUpdate) {
  if (reduced() || from === to) { onUpdate(to); return () => {}; }
  const t0 = performance.now();
  let id = 0;
  const step = (now) => {
    const p = clamp((now - t0) / ms, 0, 1);
    const e = 1 - Math.pow(1 - p, 3);
    onUpdate(from + (to - from) * e);
    if (p < 1) id = requestAnimationFrame(step);
  };
  id = requestAnimationFrame(step);
  return () => cancelAnimationFrame(id);
}
