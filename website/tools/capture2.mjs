import { chromium } from 'playwright-core';
import { buildSeed } from './seed.mjs';
const out = process.argv[2];
const b = await chromium.launch({ channel: 'chrome', headless: true });
const { data, talks } = buildSeed();
const scrub = () => {
  document.querySelectorAll('[role=status],nextjs-portal').forEach(e => e.remove());
  document.querySelectorAll('button[aria-label^="Ask Four Notes"]').forEach(e => { if (!e.classList.contains('tabbar')) e.remove(); });
  // Prompts that only exist because this profile has no calendar connected.
  for (const el of document.querySelectorAll('section,div,aside')) {
    const t = (el.textContent || '').trim();
    if (el.children.length && t.length < 140 && (t.startsWith('Next meetingSee your next') || t.startsWith('See your meetings here'))) { el.remove(); }
  }
  const ta = document.querySelector('textarea[placeholder="Ask anything"]');
  if (ta && innerWidth < 500) { let n = ta; while (n && getComputedStyle(n).position !== 'fixed' && n !== document.body) n = n.parentElement; if (n && n !== document.body) n.style.display = 'none'; }
  // Shoot only: on a short phone the app squeezes At a glance into a sliver, which is a bug, not the design.
  // Let it keep its height, and end it above the tab bar so nothing runs under the home indicator.
  const bar = document.querySelector('.tabbar');
  if (bar && innerWidth < 500) document.querySelectorAll('aside').forEach(a => {
    a.style.flexShrink = '0';
    a.style.overflow = 'hidden';
    a.style.maxHeight = `${bar.getBoundingClientRect().top - a.getBoundingClientRect().top - 12}px`;
  });
};
async function open(vp, dsf, theme = 'light', mode = 'light', iphone = false) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: dsf, colorScheme: mode, timezoneId: 'Asia/Jakarta', locale: 'en-US', permissions: ['notifications'], ...(iphone ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([d, th]) => {
    localStorage.setItem('four-notes:v1', JSON.stringify(d));
    localStorage.setItem('four-notes:onboarding', 'done');
    localStorage.setItem('four-notes:theme', th);
  }, [data, theme]);
  const p = await ctx.newPage();
  // The site's iPhone needs what a real one reports: room for the status bar and the home indicator.
  if (iphone) await (await ctx.newCDPSession(p)).send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, left: 0, bottom: 34, right: 0 } });
  await p.goto('http://localhost:3125/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForTimeout(1800);
  await p.evaluate(async ts => {
    await new Promise((res, rej) => {
      const r = indexedDB.open('four-notes-talks', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('talks', { keyPath: 'id' }); r.result.createObjectStore('audio'); };
      r.onsuccess = () => { const tx = r.result.transaction('talks', 'readwrite'); ts.forEach(t => tx.objectStore('talks').put(t)); tx.oncomplete = res; tx.onerror = rej; };
      r.onerror = rej;
    });
  }, talks);
  return p;
}
async function go(p, tab, click) {
  await p.goto(`http://localhost:3125/?tab=${tab}`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2400);
  if (click) { const r = p.getByText(click).locator('visible=true').first(); if (await r.count()) { await r.click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(1600); } }
  await p.evaluate(scrub);
  await p.waitForTimeout(300);
}
if (!process.env.IPHONE_ONLY) {
const d = await open({ width: 1440, height: 900 }, 2);
await go(d, 'today');
await d.locator('aside.sheet-side').first().screenshot({ path: `${out}/s/today-side.png` });
await go(d, 'todo');
await d.locator('main .sheet').first().screenshot({ path: `${out}/s/planner-main.png` });
await go(d, 'transcribe', 'Product sync');
await d.locator('.fn-aside.sheet').first().screenshot({ path: `${out}/s/meetings-side.png` });
await d.locator('main .sheet').first().screenshot({ path: `${out}/s/meetings-main.png` });
await go(d, 'notes', 'Weekend in Bandung');
await d.locator('main .sheet, main > div > .sheet').first().screenshot({ path: `${out}/s/notes-main.png` }).catch(() => {});
await d.locator('.fn-aside.sheet').first().screenshot({ path: `${out}/s/notes-side.png` });
await d.screenshot({ path: `${out}/s/notes-full.png` });
await go(d, 'finance');
await d.locator('main .sheet').first().screenshot({ path: `${out}/s/money-main.png` });
await d.locator('aside.sheet-side, .sheet-side').first().screenshot({ path: `${out}/s/money-side.png` });
for (const [name, theme, mode] of [['light', 'light', 'light'], ['paper', 'paper', 'light'], ['dark', 'dark', 'dark']]) {
  const m = await open({ width: 390, height: 844 }, 3, theme, mode);
  await go(m, 'today');
  await m.screenshot({ path: `${out}/s/phone-today-${name}.png` });
  if (name === 'light') for (const t of ['todo', 'transcribe', 'notes', 'finance']) {
    await go(m, t, t === 'notes' ? 'Weekend in Bandung' : t === 'transcribe' ? 'Product sync' : undefined);
    await m.screenshot({ path: `${out}/s/phone-${t}.png` });
  }
}
}
// The full-screen phone shots for the iPhone on the page.
for (const [name, theme, mode] of [['light', 'light', 'light'], ['paper', 'paper', 'light'], ['dark', 'dark', 'dark']]) {
  const m = await open({ width: 390, height: 844 }, 3, theme, mode, true);
  await go(m, 'today');
  await m.screenshot({ path: `${out}/s/iphone-today-${name}.png` });
  if (name === 'light') {
    await go(m, 'notes', 'Weekend in Bandung');
    await m.screenshot({ path: `${out}/s/iphone-notes.png` });
  }
}
await b.close();
