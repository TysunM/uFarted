// Regenerates PNG icons + social preview from public/icons/icon.svg. Usage: node scripts/make-icons.js
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const svg = fs.readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const out = (f) => new URL(`../public/icons/${f}`, import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
const shot = async (html, w, h, file) => {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${html}`);
  await page.screenshot({ path: out(file), omitBackground: true });
};
const icon = (size) => svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
await shot(icon(192), 192, 192, 'icon-192.png');
await shot(icon(512), 512, 512, 'icon-512.png');
// Maskable & Apple icons need a full-bleed background (the OS applies its own mask).
const bleed = (size, scale) => `<div style="width:${size}px;height:${size}px;background:linear-gradient(135deg,#7c3aed,#db2777);display:grid;place-items:center">
  ${svg.replace('<svg ', `<svg width="${size * scale}" height="${size * scale}" `).replace(/<rect width="512" height="512" rx="112"[^>]*\/>/, '')}</div>`;
await shot(bleed(512, 0.8), 512, 512, 'icon-maskable-512.png');
await shot(bleed(180, 1), 180, 180, 'apple-touch-icon.png');
await shot(`<div style="width:1200px;height:630px;background:linear-gradient(135deg,#7c3aed,#db2777);display:flex;align-items:center;gap:48px;padding:0 90px;box-sizing:border-box;font-family:system-ui,sans-serif;color:#fff">
  ${svg.replace('<svg ', '<svg width="300" height="300" ').replace(/<rect width="512" height="512" rx="112"[^>]*\/>/, '')}
  <div><div style="font-size:96px;font-weight:900;letter-spacing:-3px">${process.env.APP_NAME || 'uFart'}</div>
  <div style="font-size:42px;font-weight:600;opacity:.9;margin-top:8px">Gut health, with a sense of humor.</div>
  <div style="font-size:30px;opacity:.8;margin-top:18px">Bloating · Food triggers · Every toot · Free</div></div></div>`, 1200, 630, 'og.png');
await browser.close();
console.log('icons written');
