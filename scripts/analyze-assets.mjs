import fs from 'node:fs';
import sharp from 'sharp';

const files = process.argv.slice(2);
for (const f of files) {
  const buf = fs.readFileSync(f);
  const isPng = buf.slice(1, 4).toString() === 'PNG';
  console.log('==', f, buf.length, 'bytes');
  if (isPng) {
    console.log(' IHDR w,h,depth,colortype:', buf.readUInt32BE(16), buf.readUInt32BE(20), buf[24], buf[25]);
    const chunks = [];
    for (let o = 8; o < buf.length;) { const l = buf.readUInt32BE(o); chunks.push(buf.toString('latin1', o + 4, o + 8)); o += 12 + l; }
    console.log(' chunks:', [...new Set(chunks)].join(','));
  }
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const hist = new Array(8).fill(0); let blackTransparent = 0, transparent = 0;
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3]; hist[a >> 5]++;
    if (a < 255) { transparent++; if (!data[i*4] && !data[i*4+1] && !data[i*4+2]) blackTransparent++; }
  }
  console.log(' alpha hist (8 bins):', hist.join(' '), '| non-opaque:', transparent, '| pure-black non-opaque:', blackTransparent);
  // k-means on a stride sample
  const pts = []; const step = Math.max(1, Math.floor(n / 40000));
  for (let i = 0; i < n; i += step) pts.push([data[i*4], data[i*4+1], data[i*4+2], i]);
  let seeds = pts.filter((_, i) => i % Math.floor(pts.length / 8) === 0).slice(0, 8).map(p => p.slice(0, 3));
  for (let it = 0; it < 25; it++) {
    const acc = seeds.map(() => [0, 0, 0, 0]);
    for (const p of pts) { let b = 0, bd = 1e9; seeds.forEach((s, k) => { const d = (s[0]-p[0])**2+(s[1]-p[1])**2+(s[2]-p[2])**2; if (d < bd) { bd = d; b = k; } }); acc[b][0]+=p[0]; acc[b][1]+=p[1]; acc[b][2]+=p[2]; acc[b][3]++; }
    seeds = acc.map((a, k) => a[3] ? [a[0]/a[3], a[1]/a[3], a[2]/a[3]] : seeds[k]);
  }
  const counts = seeds.map(() => 0);
  const snap = seeds.map(s => { let b = null, bd = 1e9; for (const p of pts) { const d = (s[0]-p[0])**2+(s[1]-p[1])**2+(s[2]-p[2])**2; if (d < bd) { bd = d; b = p; } } return b; });
  for (const p of pts) { let b = 0, bd = 1e9; seeds.forEach((s, k) => { const d = (s[0]-p[0])**2+(s[1]-p[1])**2+(s[2]-p[2])**2; if (d < bd) { bd = d; b = k; } }); counts[b]++; }
  snap.forEach((p, k) => { const px = p[3] % info.width, py = Math.floor(p[3] / info.width); console.log(`  k${k} share ${(counts[k]/pts.length*100).toFixed(1)}% -> #${[p[0],p[1],p[2]].map(v=>v.toString(16).padStart(2,'0')).join('')} @(${px},${py})`); });
}
