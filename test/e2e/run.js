// End-to-end smoke test in real Chromium with a fake microphone.
// Usage: npm run e2e   (screenshots land in test/e2e/shots/)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { loadConfig } from '../../server/config.js';
import { buildApp } from '../../server/app.js';

const shots = new URL('./shots/', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ufarted-e2e-'));
const app = await buildApp(loadConfig({ dataDir, port: 0 }), { logger: false });
await app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${app.server.address().port}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const step = (name) => console.log(`• ${name}`);
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  step('under-13: friendly screen, sticks after reload, can still listen to the community');
  const kidCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const kid = await kidCtx.newPage();
  kid.on('pageerror', (e) => errors.push(e.message));
  const thisYear = new Date().getFullYear();
  await kid.goto(base);
  await kid.locator('#birth-year').selectOption(String(thisYear - 9));
  await kid.getByRole('button', { name: /Start tracking/ }).click();
  await kid.getByRole('heading', { name: 'Almost!' }).waitFor();
  await kid.screenshot({ path: `${shots}00-under-13.png` });
  await kid.reload();
  await kid.getByRole('heading', { name: 'Almost!' }).waitFor();
  await kid.getByRole('button', { name: /Listen to the community/ }).click();
  await kid.getByRole('heading', { name: 'Community' }).waitFor();
  assert.equal((await kidCtx.cookies()).length, 0, 'no session cookie for under-13s');
  await kidCtx.close();

  step('welcome → neutral age question → start as guest');
  await page.goto(base);
  await page.getByText('The fart tracker for your gut health. Free.').waitFor();
  const start = page.getByRole('button', { name: /Start tracking/ });
  assert.equal(await start.isDisabled(), true, 'needs an answer first');
  await page.locator('#birth-year').selectOption(String(thisYear - 13));
  assert.equal(await page.locator('#birth-month').isVisible(), true, 'borderline year asks for the month');
  assert.equal(await start.isDisabled(), true);
  await page.locator('#birth-year').selectOption(String(thisYear - 30));
  assert.equal(await page.locator('#birth-month').isVisible(), false);
  await page.screenshot({ path: `${shots}01-welcome.png` });
  await start.click();
  await page.getByRole('heading', { name: 'Today', exact: true }).waitFor();

  step('daily gut check: 2 taps, persists across reloads');
  await page.getByRole('group', { name: 'Bloating' }).getByRole('button', { name: /Bloated/ }).click();
  await page.getByText('Saved ✓').waitFor();
  await page.getByRole('group', { name: 'Belly pain' }).getByRole('button', { name: /Mild/ }).click();
  await page.reload();
  await page.getByRole('heading', { name: 'Today', exact: true }).waitFor();
  assert.equal(await page.getByRole('group', { name: 'Bloating' }).getByRole('button', { name: /Bloated/ }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('group', { name: 'Belly pain' }).getByRole('button', { name: /Mild/ }).getAttribute('aria-pressed'), 'true');

  step('log a fart with type, smell, trigger and a recording');
  await page.getByRole('button', { name: 'Log a fart' }).click();
  await page.locator('#type').selectOption('thunder');
  await page.getByText('Loud, explosive, turns heads.').waitFor();
  await page.getByRole('button', { name: /Strong/ }).click();
  await page.getByText('Possible triggers').click();
  await page.getByRole('button', { name: /Beans & lentils/ }).click();
  await page.getByRole('button', { name: /Record it/ }).click();
  await page.locator('.rec-dot').waitFor();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${shots}02-recording.png` });
  await page.getByRole('button', { name: '■ Stop' }).click();
  await page.getByRole('button', { name: /Re-record/ }).waitFor();
  assert.equal(await page.getByRole('switch').isDisabled(), true, 'guests cannot share');
  await page.screenshot({ path: `${shots}03-log-sheet.png`, fullPage: false });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Thunderclap logged!').waitFor();
  await page.locator('.entry', { hasText: 'Thunderclap' }).waitFor();

  step('quick +1 burp and pick a burp type');
  await page.getByRole('button', { name: 'Quick add one burp' }).click();
  await page.getByText('+1 burp').waitFor();
  await page.getByRole('button', { name: 'Log a burp' }).click();
  await page.locator('#type').selectOption('sulfur');
  await page.getByText(/Frequent sulfur burps/).waitFor();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Rotten Egg logged!').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}04-today.png`, fullPage: true });
  assert.equal(await page.locator('.counter.fart .num b').textContent(), '1');
  assert.equal(await page.locator('.counter.burp .num b').textContent(), '2');

  step('Save tapped while the mic is still opening saves the entry (no stuck sheet)');
  await page.evaluate(() => {
    const md = navigator.mediaDevices;
    window.__gum = md.getUserMedia.bind(md);
    md.getUserMedia = (c) => new Promise((r) => setTimeout(() => r(window.__gum(c)), 1500)); // slow permission prompt
  });
  await page.getByRole('button', { name: 'Log a fart' }).click();
  await page.getByRole('button', { name: /Record it/ }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Classic logged!').waitFor({ timeout: 8000 });
  await page.locator('.backdrop').waitFor({ state: 'detached' });
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = window.__gum; });

  step('claim username → recovery code');
  await page.getByRole('link', { name: /Me/ }).click();
  await page.locator('input[name=username]').fill('thunder_buns');
  await page.locator('input[name=password]').fill('supersecret1');
  await page.getByRole('button', { name: 'Claim username' }).click();
  await page.locator('.code-box').waitFor();
  await page.screenshot({ path: `${shots}05-recovery.png` });
  await page.getByRole('button', { name: 'I saved it' }).click();
  await page.getByRole('heading', { name: '@thunder_buns' }).waitFor();

  step('share the recorded clip to the community');
  await page.getByRole('link', { name: /Today/ }).click();
  await page.locator('.entry', { hasText: 'Thunderclap' }).click();
  await page.getByRole('switch').check();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Updated').waitFor();

  step('community feed: play + react');
  await page.getByRole('link', { name: /Community/ }).click();
  const post = page.locator('article.post', { hasText: '@thunder_buns' }).first();
  await post.waitFor();
  await post.getByRole('button', { name: 'Play clip' }).click();
  await page.waitForTimeout(600);
  await post.getByRole('button', { name: 'React 😂' }).click();
  await post.locator('.react[aria-pressed="true"]').waitFor();
  await page.screenshot({ path: `${shots}06-community.png`, fullPage: true });

  step('insights');
  await page.getByRole('link', { name: /Insights/ }).click();
  await page.getByRole('heading', { name: '🩺 Gut health' }).waitFor();
  await page.getByText(/Bloating 2\/3 on days with it/).waitFor();
  await page.screenshot({ path: `${shots}07-insights.png`, fullPage: true });

  step('dark mode + public share link');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('link', { name: /Today/ }).click();
  await page.getByRole('heading', { name: 'Today', exact: true }).waitFor();
  await page.screenshot({ path: `${shots}08-today-dark.png`, fullPage: true });
  const postId = (await (await page.request.get(`${base}/api/posts`)).json()).posts[0].id;
  const anon = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  anon.on('pageerror', (e) => errors.push(e.message));
  await anon.goto(`${base}/p/${postId}`);
  await anon.getByText('Track yours too').waitFor();
  await anon.screenshot({ path: `${shots}09-shared-link.png` });

  step('doctor report');
  const report = await ctx.newPage();
  await report.goto(`${base}/report`);
  await report.getByText('Bloating & gas summary').waitFor();
  await report.getByText('Days with moderate/severe bloating').waitFor();
  await report.screenshot({ path: `${shots}10-report.png`, fullPage: true });

  const csp = errors.filter((e) => /Content Security Policy|Refused/.test(e));
  assert.deepEqual(csp, [], 'no CSP violations');
  assert.deepEqual(errors.filter((e) => !/favicon/.test(e)), [], 'no console errors');
  console.log('E2E PASSED');
} catch (err) {
  console.error('E2E FAILED:', err.message, '\nconsole errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
