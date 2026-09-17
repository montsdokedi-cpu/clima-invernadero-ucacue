// Genera los iconos y la pantalla de inicio de la app Android a partir de public/icon.svg
import sharp from 'sharp';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url));
const res = (p) => fileURLToPath(new URL(`../android/app/src/main/res/${p}`, import.meta.url));
const GREEN = '#2f7d4a';
const BG = '#f4f7f3';

const LAUNCHER = { 'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96, 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192 };
const FOREGROUND = { 'mipmap-mdpi': 108, 'mipmap-hdpi': 162, 'mipmap-xhdpi': 216, 'mipmap-xxhdpi': 324, 'mipmap-xxxhdpi': 432 };
// Pantalla de inicio: retrato y paisaje por densidad
const SPLASH = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };

const ensure = (dir) => { if (!existsSync(res(dir))) mkdirSync(res(dir), { recursive: true }); };

for (const [dir, size] of Object.entries(LAUNCHER)) {
  ensure(dir);
  const icon = await sharp(svg).resize(size, size).png().toBuffer();
  await sharp(icon).toFile(res(`${dir}/ic_launcher.png`));
  // Versión redonda: el mismo icono recortado en círculo
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
  await sharp(icon).composite([{ input: mask, blend: 'dest-in' }]).png().toFile(res(`${dir}/ic_launcher_round.png`));
}

// Icono adaptativo: el logo dentro de la zona segura, sobre fondo verde
for (const [dir, size] of Object.entries(FOREGROUND)) {
  const inner = Math.round(size * 0.58);
  const logo = await sharp(svg).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: logo, top: Math.round((size - inner) / 2), left: Math.round((size - inner) / 2) }])
    .png()
    .toFile(res(`${dir}/ic_launcher_foreground.png`));
}

for (const [density, [w, h]] of Object.entries(SPLASH)) {
  for (const orientation of ['port', 'land']) {
    const [width, height] = orientation === 'port' ? [w, h] : [h, w];
    const dir = `drawable-${orientation}-${density}`;
    ensure(dir);
    const logoSize = Math.round(Math.min(width, height) * 0.32);
    const logo = await sharp(svg).resize(logoSize, logoSize).png().toBuffer();
    await sharp({ create: { width, height, channels: 4, background: BG } })
      .composite([{ input: logo, gravity: 'center' }])
      .png()
      .toFile(res(`${dir}/splash.png`));
  }
}
// Pantalla de inicio genérica
const logo = await sharp(svg).resize(360, 360).png().toBuffer();
await sharp({ create: { width: 1280, height: 1920, channels: 4, background: BG } })
  .composite([{ input: logo, gravity: 'center' }])
  .png()
  .toFile(res('drawable/splash.png'));

console.log('Iconos y splash de Android generados (fondo del icono adaptativo:', GREEN, ')');
