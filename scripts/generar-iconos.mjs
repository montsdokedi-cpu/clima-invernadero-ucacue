// Genera los íconos PNG de la PWA a partir de public/icon.svg
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url));
const out = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));

await sharp(svg).resize(192, 192).png().toFile(out('pwa-192.png'));
await sharp(svg).resize(512, 512).png().toFile(out('pwa-512.png'));
await sharp(svg).resize(180, 180).png().toFile(out('apple-touch-icon.png'));
// Maskable: ícono con margen de seguridad sobre fondo verde
const inner = await sharp(svg).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#2f7d4a' } })
  .composite([{ input: inner, top: 56, left: 56 }])
  .png()
  .toFile(out('pwa-512-maskable.png'));
console.log('Íconos generados en public/');
