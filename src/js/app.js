import { initReveal, initProgress, initSpotlight, initParallax, initMesh } from './motion.js';
import { initMarket } from './market.js';
import { copyText, announce } from './copy.js';

initProgress();
initSpotlight();
initMesh();
initParallax();
initReveal();
initMarket();

/* Contract slot: only the live variant is a button, the pending one stays inert. */
const slot = document.querySelector('[data-slot="contract"]');
if (slot && slot.tagName === 'BUTTON') {
  const hint = slot.querySelector('.ca__hint');
  slot.addEventListener('click', async () => {
    const ok = await copyText(slot.querySelector('.ca__addr').textContent.trim());
    announce(ok ? 'Contract address copied' : 'Copy failed');
    if (!ok) return;
    slot.classList.add('is-done');
    hint.textContent = 'Copied';
    clearTimeout(slot._t);
    slot._t = setTimeout(() => { slot.classList.remove('is-done'); hint.textContent = 'Tap to copy'; }, 1800);
  });
}
