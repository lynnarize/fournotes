/* Four Notes site.
   One clock (gsap.ticker), one scrubbed timeline for the stage. Without GSAP or with
   reduced motion, `html.live` is removed and the page stays in plain, complete flow. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGsap = !!(window.gsap && window.ScrollTrigger);
  const live = !calm && hasGsap;
  window.__fnReady = true;
  if (!live) root.classList.remove('live');
  const isPhone = () => matchMedia('(max-width: 760px)').matches;
  const px = name => parseFloat(getComputedStyle(root).getPropertyValue(name)) || 0;

  /* ───────── True things: today's date, the year, the latest release ───────── */
  const now = new Date();
  const dateLine = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  $$('[data-date],[data-dock-date]').forEach(el => { el.textContent = dateLine; });
  const hour = now.getHours();
  $$('[data-greet]').forEach(el => { el.textContent = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'; });
  $$('[data-year]').forEach(el => { el.textContent = now.getFullYear(); });

  (async function latestRelease() {
    const KEY = 'fournotes:latest-release:v3', FRESH = 5 * 60e3;
    const apply = rel => {
      if (rel.version) $$('[data-version]').forEach(el => { el.textContent = rel.version; });
      if (rel.url) $$('[data-version-link]').forEach(a => a.setAttribute('href', rel.url));
      if (rel.dmg && /^https:\/\/github\.com\//.test(rel.dmg)) $$('[data-download]').forEach(a => a.setAttribute('href', rel.dmg));
    };
    try {
      const cached = JSON.parse(localStorage.getItem(KEY));
      if (cached && Date.now() - cached.at < FRESH) return apply(cached.rel);
    } catch { /* storage unavailable */ }
    try {
      const res = await fetch('https://api.github.com/repos/lynnarize/fournotes-macos/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const match = [data.name, data.tag_name].map(s => /(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.]+)?)/.exec(s || '')).find(Boolean);
      const dmg = (data.assets || []).find(a => /\.dmg$/i.test(a.name) && a.browser_download_url);
      const rel = { version: match ? match[1] : null, url: data.html_url, dmg: dmg ? dmg.browser_download_url : null };
      apply(rel);
      try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), rel })); } catch { /* fine */ }
    } catch { /* offline: the links still open the Releases page */ }
  })();

  /* ───────── Words: what the bar understands. A small, honest version of the app's. ───────── */
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const titleCase = s => s.replace(/(^|[\s\-(])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  const rupiah = n => 'Rp ' + Math.round(n).toLocaleString('en-US');
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const CATEGORIES = [
    ['Food & Drink', /kopi|coffee|latte|\btea\b|\bteh\b|lunch|dinner|breakfast|brunch|makan|food|warteg|starbucks|kenangan|resto|cafe|café|nasi|bakso|sate|satay|\bmie\b|noodle|ramen|sushi|pizza|burger|bread|\broti\b|snack|hokben|gacoan/i],
    ['Groceries', /grocer|indomaret|alfamart|superindo|supermarket|market|pasar|sayur|beras|\bmilk\b|susu|\beggs?\b|telur/i],
    ['Transport', /gojek|goride|grab|taxi|taksi|bluebird|uber|fuel|bensin|pertamina|parking|parkir|\btoll?\b|train|\bkrl\b|\bmrt\b|transjakarta|flight/i],
    ['Entertainment', /netflix|spotify|youtube|disney|cinema|bioskop|\bcgv\b|\bxxi\b|movie|\bfilm\b|concert|\bgame|steam/i],
    ['Bills & Utilities', /electric|listrik|\bpln\b|internet|wifi|indihome|water bill|pdam|\brent\b|sewa|\bkost\b|phone|pulsa|\bbill\b|tagihan/i],
    ['Health', /doctor|dokter|pharmacy|apotek|kimia farma|guardian|medicine|\bobat\b|dentist|\bgym\b|clinic|klinik/i],
    ['Education', /\bbooks?\b|\bbuku\b|gramedia|course|kursus|class\b|kelas|school|sekolah/i],
    ['Shopping', /shirt|\bbaju\b|uniqlo|zara|\bshoes\b|sepatu|tokopedia|shopee|lazada|\bgift\b|\bkado\b|ikea/i],
  ];
  const KNOWN = ['kopi kenangan', 'starbucks', 'gojek', 'grab', 'indomaret', 'alfamart', 'superindo', 'tokopedia', 'shopee', 'netflix', 'spotify', 'warteg', 'uniqlo', 'pertamina', 'gramedia', 'bluebird'];
  const categoryOf = s => (CATEGORIES.find(([, re]) => re.test(s)) || ['Other'])[0];
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_RE = '(sun|mon|tue|tues|wed|wednes|thu|thur|thurs|fri|sat|satur)(?:day)?';

  function amountOf(s) {
    const re = /(rp\.?\s*|\$\s*)?(\d+(?:[.,]\d+)*)\s*(k|rb|ribu|jt|juta|m|mio|million|thousand)?(?![\p{L}\d:])/giu;
    let best = null, m;
    while ((m = re.exec(s))) {
      const [, pre, num, unit] = m;
      let n;
      if (unit) n = parseFloat(num.replace(',', '.'));
      else if (/^\d{1,3}([.,]\d{3})+$/.test(num)) n = parseFloat(num.replace(/[.,]/g, ''));
      else n = parseFloat(num.replace(',', '.'));
      n *= { k: 1e3, rb: 1e3, ribu: 1e3, thousand: 1e3, jt: 1e6, juta: 1e6, m: 1e6, mio: 1e6, million: 1e6 }[(unit || '').toLowerCase()] || 1;
      const strong = !!(unit || pre);
      if (!strong && (n < 500 || (n >= 1900 && n <= 2100))) continue;
      if (!best || (strong && !best.strong) || (strong === best.strong && n > best.n)) best = { n, strong };
    }
    return best;
  }
  function merchantOf(s) {
    const clean = s.replace(/\b(split|with|sama|bareng|dengan)\b.*$/i, '');
    let m = s.match(/\b(?:at|di|@|from|dari)\s+([^,.;!?]+?)(?=\s*(?:,|\.|;|!|\?|$|\bsplit\b|\bfor\b|\bwith\b|\bsama\b|\bbareng\b|\btoday\b|\byesterday\b|\bkemarin\b))/i);
    if (m && !/^\d/.test(m[1])) return titleCase(m[1].trim().replace(/^the\s+/i, ''));
    const lower = s.toLowerCase();
    const known = KNOWN.find(k => lower.includes(k));
    if (known) return titleCase(known);
    m = clean.match(/\bon\s+(?:a\s+|the\s+|my\s+)?([\p{L}][^,.;!?\d]*?)\s*(?=,|\.|;|!|\?|$|\d)/iu);
    if (m) return titleCase(m[1].trim());
    const words = clean.replace(/(rp\.?\s*|\$)?\d+(?:[.,]\d+)*\s*(k|rb|ribu|jt|juta|m|mio)?\b/gi, ' ').split(/[\s,.;!?]+/)
      .filter(w => w && !/^(i|spent|spend|paid|pay|bought|buy|beli|bayar|habis|for|the|a|an|on|to|rp|just|today|yesterday|kemarin|tadi|is|every|month|monthly)$/i.test(w));
    return words.length ? titleCase(words.slice(0, 3).join(' ')) : 'Purchase';
  }
  function splitOf(s) {
    const m = s.match(/\bsplit\b(?:\s+it)?(?:\s+(?:with|sama|dengan|bareng)\s+([^.;!?]+))?/i);
    if (!m || !m[1]) return m ? [] : null;
    return m[1].split(/\s*(?:,|&|\band\b|\bdan\b)\s*/i).map(n => titleCase(n.trim())).filter(Boolean).slice(0, 5);
  }
  function whenOf(s) {
    const lower = s.toLowerCase();
    const today = new Date();
    let rec = null;
    if (/\b(daily|every\s*day|each day|tiap hari|setiap hari)\b/.test(lower)) rec = 'Every day';
    else if (/\b(weekly|(every|each|tiap|setiap)\s+(week|minggu))\b/.test(lower)) rec = 'Weekly';
    else if (/\b(monthly|(every|each|tiap|setiap)\s+(month|bulan))\b/.test(lower)) rec = 'Monthly';
    else if (/\b(yearly|annually|(every|each|tiap|setiap)\s+(year|tahun))\b/.test(lower)) rec = 'Yearly';

    let h = null, min = 0;
    const t = lower.match(/\b(?:at|jam|pukul)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|pagi|siang|sore|malam)?\b/) || lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
    if (t) {
      h = parseInt(t[1], 10); min = t[2] ? parseInt(t[2], 10) : 0;
      const ap = t[3] || '';
      if (/pm|sore|malam/.test(ap) && h < 12) h += 12;
      if (/siang/.test(ap) && h < 11) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      if (h > 23) h = null;
    }
    if (h === null && /\btonight\b|\bnanti malam\b/.test(lower)) h = 20;

    let d = null;
    const y = today.getFullYear(), mo = today.getMonth(), da = today.getDate();
    const dom = lower.match(/\bon the (\d{1,2})(?:st|nd|rd|th)?\b|\btanggal (\d{1,2})\b|\bthe (\d{1,2})(?:st|nd|rd|th)\b/);
    const wd = lower.match(new RegExp(`\\b${DAY_RE}\\b`));
    if (dom) {
      const n = parseInt(dom[1] || dom[2] || dom[3], 10);
      d = new Date(y, mo, n, h ?? 9, min);
      if (d <= today) d = new Date(y, mo + 1, n, h ?? 9, min);
    } else if (wd) {
      const target = DAYS.findIndex(x => wd[1].startsWith(x));
      d = new Date(y, mo, da + (((target - today.getDay() + 7) % 7) || 7), h ?? 9, min);
    } else if (/\b(tomorrow|besok)\b/.test(lower)) {
      d = new Date(y, mo, da + 1, h ?? 9, min);
    } else if (/\bnext week\b|\bminggu depan\b/.test(lower)) {
      d = new Date(y, mo, da + 7, h ?? 9, min);
    } else if (/\bnext month\b|\bbulan depan\b/.test(lower)) {
      d = new Date(y, mo + 1, da, h ?? 9, min);
    } else if (h !== null || /\b(today|tonight|hari ini)\b/.test(lower)) {
      d = new Date(y, mo, da, h ?? 18, min);
      if (d <= today) d.setDate(d.getDate() + 1);
    }
    return { d, rec, hasWhen: !!(d || rec), hasTime: h !== null };
  }
  function dueLabel(w) {
    if (!w.d) return 'Tomorrow';
    const day = w.d.toDateString() === new Date().toDateString() ? 'Today'
      : new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(w.d);
    const pad = n => String(n).padStart(2, '0');
    return w.hasTime ? `${day} · ${pad(w.d.getHours())}:${pad(w.d.getMinutes())}` : day;
  }
  function taskTitle(s) {
    let t = s.replace(/^\s*(please\s+)?(can you\s+)?(remind me (to|about)|reminder( to)?:?|ingatkan( saya| aku)?( untuk| buat)?|ingetin( saya| aku)?( untuk| buat)?|jangan lupa)\s+/i, '');
    const cut = t.search(new RegExp(`\\s+(?:every|each|daily|weekly|monthly|tiap|setiap|on the|on|at|by|tomorrow|besok|today|tonight|hari ini|next|this|in \\d|jam|pukul|tanggal|${DAY_RE}\\b|rp\\.?\\s*\\d|\\$\\s*\\d|\\d)`, 'i'));
    if (cut > 0) t = t.slice(0, cut);
    t = t.replace(/[,.;!?\s]+$/, '').replace(/\s+(is|are|costs?|for|=|:)$/i, '');
    return cap(t.trim()) || 'New task';
  }
  function one(raw) {
    const s = raw.trim().replace(/\s+/g, ' ');
    if (!s) return null;
    if (/\?\s*$/.test(s) || /^(how|what|when|where|who|why|which|do|did|does|is|are|can|could|should|berapa|apa|kapan|siapa|kenapa|gimana)\b/i.test(s)) {
      return { kind: 'ask', tag: 'Ask', title: cap(s.replace(/\?*\s*$/, '?')), meta: ['Answered from your notes, with sources'], where: 'Assistant' };
    }
    const amount = amountOf(s);
    if (/\bbudget\b|\banggaran\b/i.test(s) && amount) {
      return { kind: 'spend', tag: 'Budget', title: `${categoryOf(s.replace(/\bbudget\b/i, ''))} budget`, meta: ['Every month'], amt: rupiah(amount.n), where: 'Money' };
    }
    const when = whenOf(s);
    const spendVerb = /\b(spent|spend|paid|bought|beli|bayar|habis|kena)\b/i.test(s);
    const remind = /\b(remind|reminder|ingatkan|ingetin|jangan lupa)\b/i.test(s);
    const subscription = amount && when.rec && !remind && /\b(netflix|spotify|youtube|disney|is)\b/i.test(s);
    if (subscription) {
      return { kind: 'task', tag: 'Bill', title: merchantOf(s), meta: [when.rec, categoryOf(s)], amt: rupiah(amount.n), where: 'Planner' };
    }
    if (remind || (when.hasWhen && !spendVerb) || /^(buy|call|email|send|renew|book|pay|water|ask|beli|telepon)\b/i.test(s) && !amount) {
      const meta = [dueLabel(when)];
      if (when.rec) meta.push(when.rec);
      if (amount) meta.push('Bill');
      return { kind: 'task', tag: 'Task', title: taskTitle(s), meta, amt: amount ? rupiah(amount.n) : null, where: 'Planner' };
    }
    if (amount) {
      const split = splitOf(s);
      const meta = ['Today', categoryOf(s)];
      if (split && split.length) meta.push(`Split with ${split.join(', ')}`);
      return { kind: 'spend', tag: 'Spend', title: merchantOf(s), meta, amt: rupiah(amount.n), where: 'Money', n: amount.n };
    }
    return { kind: 'note', tag: 'Note', title: cap(s.length > 56 ? s.slice(0, 54).trim() + '…' : s), meta: ['Quick note', 'Goes into today\'s summary'], where: 'Notes' };
  }
  function understand(raw) {
    const parts = [];
    raw.split(/[;,]|\s+(?:then|lalu|terus)\s+/i).forEach(c => {
      const part = c.trim();
      if (!part) return;
      if (parts.length && /^(split|with|sama|bareng|and split|at \d|jam)\b/i.test(part)) parts[parts.length - 1] += `, ${part}`;
      else parts.push(part);
    });
    return parts.map(one).filter(Boolean).slice(0, 5);
  }
  const rowHTML = it => `
    <span class="tag tag-${it.kind}">${esc(it.tag)}</span>
    <span class="bd"><span class="t">${esc(it.title)}</span><span class="meta">${it.meta.map((m, i) => `<span${i ? '' : ' class="tm"'}>${esc(m)}</span>`).join('')}</span></span>
    ${it.amt ? `<span class="amt">${esc(it.amt)}</span>` : `<span class="where"><span>${esc(it.where)}</span></span>`}`;

  /* The bar, on the page */
  (function demo() {
    const form = $('[data-demo-form]');
    if (!form) return;
    const input = $('[data-demo-input]'), list = $('[data-demo-rows]'), empty = $('[data-demo-empty]');
    const file = text => {
      const items = understand(text);
      if (!items.length) return;
      empty.hidden = true;
      const fresh = items.map(it => {
        const li = document.createElement('li');
        li.className = 'row';
        li.innerHTML = rowHTML(it);
        list.prepend(li);
        return li;
      });
      while (list.children.length > 5) list.lastElementChild.remove();
      if (live) gsap.from(fresh, { y: 14, opacity: 0, duration: 0.5, ease: 'expo.out', stagger: 0.06, clearProps: 'transform,opacity' });
    };
    form.addEventListener('submit', e => { e.preventDefault(); file(input.value); input.value = ''; });
    let typing = null;
    $$('[data-try]').forEach(b => b.addEventListener('click', () => {
      const text = b.textContent.trim();
      if (typing) typing.kill();
      if (!live) { file(text); return; }
      const o = { n: 0 };
      typing = gsap.to(o, { n: text.length, duration: Math.min(0.9, text.length * 0.018), ease: 'none',
        onUpdate: () => { input.value = text.slice(0, Math.round(o.n)); },
        onComplete: () => { gsap.delayedCall(0.14, () => { file(text); input.value = ''; }); } });
    }));
  })();

  /* The command list: one ink block slides behind the row in use */
  (function commands() {
    const box = $('[data-cmds]');
    if (!box || !live) return;
    const ul = $('ul', box), rows = $$('.cmd', box);
    const bg = document.createElement('li');
    bg.className = 'cmd-bg';
    bg.setAttribute('aria-hidden', 'true');
    ul.prepend(bg);
    const say = document.createElement('p');
    say.className = 'cmds-say';
    say.setAttribute('aria-live', 'polite');
    box.append(say);
    const moveTo = (i, jump) => {
      rows.forEach((r, k) => { r.classList.toggle('is-on', k === i); r.setAttribute('aria-pressed', k === i); });
      const r = rows[i];
      gsap.set(bg, { height: r.offsetHeight });
      gsap.to(bg, { y: r.parentElement.offsetTop, duration: jump ? 0 : 0.42, ease: 'power3.out', overwrite: true });
      say.textContent = $('.cmd-say', r.parentElement).textContent;
    };
    rows.forEach((r, i) => {
      r.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') moveTo(i); });
      r.addEventListener('focus', () => moveTo(i));
      r.addEventListener('click', () => moveTo(i));
    });
    moveTo(0, true);
    addEventListener('resize', () => moveTo(rows.findIndex(r => r.classList.contains('is-on')), true));
    document.fonts && document.fonts.ready.then(() => moveTo(rows.findIndex(r => r.classList.contains('is-on')), true));
  })();

  /* ───────── Scroll ───────── */
  let lenis = null;
  if (live) {
    gsap.registerPlugin(ScrollTrigger);
    if (window.Lenis) {
      lenis = new Lenis({ lerp: 0.12, smoothWheel: true });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(t => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
    }
  }
  const scrollTo = (y, opts = {}) => {
    if (lenis) lenis.scrollTo(y, { duration: 1.2, ...opts });
    else window.scrollTo({ top: typeof y === 'number' ? y : y.getBoundingClientRect().top + scrollY - px('--bar'), behavior: 'auto' });
  };

  /* ───────── The stage: one timeline, in screens of scroll ───────── */
  let stage = null;
  const AT = { capture: 1.45, planner: 2.95, meetings: 3.8, notes: 4.65, money: 5.5, end: 6.4 };
  const chapterAt = [0, AT.planner + 0.12, AT.meetings + 0.12, AT.notes + 0.12, AT.money + 0.12];

  function setPlace(i) {
    $$('[data-place]').forEach(a => { const on = +a.dataset.place === i; a.classList.toggle('is-on', on); if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
  }
  const inkWords = el => {
    if (el.dataset.split) return $$('.w', el);
    const text = el.textContent.trim();
    el.dataset.split = '1';
    el.innerHTML = text.split(/\s+/).map(w => `<span class="w">${esc(w)}</span>`).join(' ');
    return $$('.w', el);
  };

  function flip(src, dst) {
    const a = src.getBoundingClientRect(), b = dst.getBoundingClientRect();
    const fsA = parseFloat(getComputedStyle(src).fontSize), fsB = parseFloat(getComputedStyle(dst).fontSize);
    const s = src.classList.contains('mk') ? b.height / a.height : fsB / fsA;
    // The load animation may still be lifting the line: measure where it will come to rest.
    const line = src.closest('.ln');
    const lift = line ? parseFloat((getComputedStyle(line).translate || '').split(' ')[1]) || 0 : 0;
    return { x: b.left - a.left, y: b.top + b.height / 2 - (a.top - lift + (a.height * s) / 2), scale: s };
  }

  /* The app is laid out at its own size, then scaled into a frame on the site's sheet. */
  function fitPreview() {
    const pin = $('[data-pin]'), sheet = $('.paper-bg');
    const pad = px('--pad'), bz = px('--bz'), note = 34;
    const copyH = Math.max(...$$('.ch-copy').map(c => c.offsetHeight));
    const roomW = sheet.offsetWidth - pad * 2 - bz * 2;
    const roomH = sheet.offsetHeight - copyH - note - bz * 2;
    let w = px('--app-w'), h = px('--app-h'), k;
    // A phone shows the app at its real size, in a window as wide as the screen allows.
    if (isPhone()) { k = 1; w = Math.min(roomW, 440); h = Math.min(roomH, 680); }
    else { k = Math.min(1, roomW / w, roomH / h); h = Math.min(roomH / k, h * 1.3); }
    const fw = w * k + bz * 2, fh = h * k + bz * 2;
    const top = sheet.offsetTop + Math.max(0, (roomH - h * k) / 2);
    const fy = top + copyH;
    Object.entries({ '--k': k, '--app-w': w, '--app-h': h, '--fw': `${fw}px`, '--fh': `${fh}px`, '--fx': `${sheet.offsetLeft + (sheet.offsetWidth - fw) / 2}px`, '--fy': `${fy}px`, '--copy-top': `${top}px` })
      .forEach(([n, v]) => pin.style.setProperty(n, v));
    return { k, fy };
  }

  function buildStage() {
    const phone = isPhone();
    const soft = phone ? {} : { filter: 'blur(9px)' }, sharp = phone ? {} : { filter: 'blur(0px)' };
    const win = $('[data-win]');
    const app = name => parseFloat(getComputedStyle(win).getPropertyValue(name)) || 0;
    const { k, fy } = fitPreview();
    gsap.set('.win, .ch-screen', { scale: k, transformOrigin: '0 0' });

    const g = app('--g');
    const hasSide = $('.ch-today .ch-side').offsetWidth > 0;
    const sw = hasSide ? $('.ch-today .ch-side').offsetWidth + g : 0, sw2 = hasSide ? $('.ch-meetings .ch-side').offsetWidth + g : 0;
    const paper = $('[data-paper]');
    const clip = { r: sw };
    const paintClip = () => { if (!phone) paper.style.clipPath = `inset(0 ${clip.r}px 0 0 round ${app('--r')}px)`; };
    const typed = 'kopi kenangan 38k, pay rent fri 9am, call budi monday';
    const omni = $('.win-omni'), omniText = $('[data-omni-text]');
    const place = omniText.textContent;
    const o = { n: 0 };
    const setTyped = () => {
      const n = Math.round(o.n);
      omni.classList.toggle('is-typing', n > 0);
      omniText.textContent = n > 0 ? typed.slice(0, n) : place;
      omni.classList.toggle('is-long', n > 0 && omniText.scrollWidth > omniText.clientWidth);
    };

    // Everything measured from the rest pose, then the rest pose is never touched by CSS again.
    const words = $$('[data-w]').map(el => ({ el, ...flip(el, $(`[data-t="${el.dataset.w}"]`)) }));
    // On a short screen a row can sit below the frame's edge: its mark stops at the edge instead.
    const floor = $('[data-frame]').getBoundingClientRect().bottom - 20;
    const marks = $$('[data-mk]').map((el, i) => {
      const slot = $(`[data-slot="${i}"]`);
      return { el, ...flip(el, slot), under: Math.max(0, slot.getBoundingClientRect().bottom - floor) };
    });

    const risers = ['[data-frame]', '.ch-today .ch-screen', '[data-over]'];
    const todayLine = $('.ch-today .ch-copy p');
    const todayHead = '.ch-today .scr-title, .ch-today .ch-date, .sum';
    gsap.set(risers, { y: $('[data-pin]').offsetHeight - fy + 40 });
    gsap.set(marks.map(m => m.el), { transformOrigin: '0 0' });
    gsap.set('.slot', { opacity: 0 });
    gsap.set(`[data-row] > :not(.slot), ${todayHead}`, { opacity: 0, y: 10 });
    gsap.set('[data-panel]', { opacity: 0, y: -14 });
    gsap.set('[data-it]', { opacity: 0, y: 10 });
    gsap.set('.ch:not(.ch-today) .ch-side', { x: sw2 + 24, opacity: 0 });

    const tl = gsap.timeline({ defaults: { ease: 'none' },
      scrollTrigger: { trigger: '[data-stage]', start: 'top top', end: 'bottom bottom', scrub: true,
        onUpdate: self => {
          const t = self.progress * AT.end;
          let i = 0;
          chapterAt.forEach((at, k) => { if (t >= at) i = k; });
          if (i !== stage?.place) { stage.place = i; setPlace(i); }
          const filed = t > AT.capture + 1.04;
          if (filed !== stage?.filed) {
            stage.filed = filed;
            $('[data-count="planner"]').textContent = filed ? 10 : 8;
            $('[data-count="money"]').textContent = filed ? 12 : 11;
          }
        } } });

    /* Beat 1: the headline settles above the frame, the window rises, the marks land as its rows */
    tl.to('[data-hero-fade]', { y: 26, autoAlpha: 0, duration: 0.3, stagger: 0.03, ease: 'power2.in' }, 0.04);
    // Line one lifts clear of the marks before it closes up; line two only rises once line one has made room.
    words.forEach(w => {
      const second = w.el.dataset.w === 'one';
      tl.to(w.el, { y: w.y, duration: second ? 0.56 : 0.62, ease: 'power3.inOut' }, second ? 0.3 : 0.08);
      tl.to(w.el, { x: w.x, scale: w.scale, duration: 0.62, ease: 'power3.inOut' }, second ? 0.14 : 0.16);
    });
    tl.to(risers, { y: 0, duration: 0.84, ease: 'power3.inOut' }, 0.2);
    marks.forEach((m, i) => {
      const at = 0.5 + i * 0.05, landed = at + 0.72;
      tl.to(m.el, { x: m.x, duration: 0.72, ease: 'power2.inOut' }, at);
      tl.to(m.el, { y: m.y, scale: m.scale, duration: 0.86, ease: 'power2.inOut' }, at - 0.14);
      // Landed: the row's own mark takes over, so the window clips, dims and scrolls it like any row.
      // A mark whose row is below the window's edge fades on the way instead of piling up there.
      if (m.under) tl.to(m.el, { autoAlpha: 0, duration: 0.2 }, at + 0.2);
      else tl.set(m.el, { autoAlpha: 0 }, landed);
      tl.set(`[data-slot="${i}"]`, { opacity: 1 }, landed);
    });
    tl.fromTo(todayLine, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }, 0.78);
    tl.to(todayHead, { opacity: 1, y: 0, duration: 0.3, stagger: 0.05, ease: 'power2.out' }, 0.86);
    $$('[data-row]').forEach((row, i) => tl.to($$(':scope > :not(.slot)', row), { opacity: 1, y: 0, duration: 0.26, ease: 'power2.out' }, 1.02 + i * 0.05));

    /* Beat 2: one sentence in the window's bar; it breaks into three filed things */
    const a = AT.capture;
    tl.set('.capture', { visibility: 'visible' }, a - 0.01);
    tl.to([...$$('.wd'), todayLine], { opacity: 0, y: '-=12', duration: 0.12, ease: 'power1.in' }, a);
    const say = inkWords($('#say-title'));
    tl.fromTo(say, { opacity: 0, ...soft }, { opacity: 1, ...sharp, duration: 0.18, stagger: 0.04 }, a + 0.12);
    tl.fromTo('.say p', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.16 }, a + 0.3);
    tl.fromTo('[data-scrim]', { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power1.out' }, a + 0.04);
    tl.to(o, { n: typed.length, duration: 0.38, onUpdate: setTyped }, a + 0.08);
    tl.to('[data-panel]', { opacity: 1, y: 0, duration: 0.16, ease: 'power2.out' }, a + 0.5);
    $$('[data-it]').forEach((it, i) => tl.to(it, { opacity: 1, y: 0, duration: 0.12, ease: 'power2.out' }, a + 0.56 + i * 0.09));
    tl.to('[data-panel]', { opacity: 0, y: -14, duration: 0.14, ease: 'power1.in' }, a + 1.0);
    tl.to('[data-scrim]', { opacity: 0, duration: 0.18 }, a + 1.02);
    tl.to(o, { n: 0, duration: 0.08, onUpdate: setTyped }, a + 1.0);
    tl.fromTo('[data-filed]', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.2, ease: 'power2.out' }, a + 1.06);
    // Where the sheet is too short for the filed rows, it scrolls to them.
    const pad = $('.ch-today .ch-pad'), sheet = $('.ch-today .ch-main');
    const scrollBy = Math.min(Math.max(0, pad.offsetHeight - sheet.clientHeight + (phone ? 24 : 0)), $('[data-row]').offsetTop - 12);
    if (scrollBy) tl.to(pad, { y: -scrollBy, duration: 0.2, ease: 'power2.inOut' }, a + 1.04);
    tl.fromTo('[data-toast]', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.1, ease: 'power2.out' }, a + 1.08);
    tl.to('[data-toast]', { autoAlpha: 0, duration: 0.08 }, a + 1.36);
    tl.to('.say', { opacity: 0, y: -14, duration: 0.14, ease: 'power1.in' }, AT.planner - 0.16);
    tl.set('.capture', { visibility: 'hidden' }, AT.planner);

    /* Chapters: the words change above the frame, the sheet resizes inside it the way the app's does */
    const chapter = (id, at, right, sideIn) => {
      const el = $(`#${id}`);
      const title = $('.ch-title', el), p = $('.ch-copy p', el), body = $('.shot, .enh', el), s = $('.ch-side', el);
      const ws = inkWords(title);
      tl.set(el, { visibility: 'visible' }, at);
      if (!phone) tl.to(clip, { r: right, duration: 0.36, ease: 'power3.inOut', onUpdate: paintClip }, at - 0.02);
      tl.fromTo(ws, { opacity: 0.08, ...soft }, { opacity: 1, ...sharp, duration: 0.16, stagger: 0.022 }, at + 0.06);
      tl.fromTo(p, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out' }, at + 0.2);
      tl.fromTo(body, { opacity: 0, y: 34 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power3.out' }, at + 0.14);
      if (s && hasSide) tl.to(s, { x: 0, opacity: 1, duration: sideIn ? 0.36 : 0.2, ease: 'power3.inOut' }, at + (sideIn ? 0 : 0.08));
      return el;
    };
    const leave = (id, at, keepSide) => {
      const el = $(`#${id}`);
      const s = $('.ch-side', el);
      tl.to([$('.ch-main', el), $('.ch-copy', el)], { opacity: 0, y: -18, duration: 0.14, ease: 'power1.in' }, at - 0.16);
      if (s && hasSide) tl.to(s, keepSide ? { opacity: 0, duration: 0.14 } : { x: sw2 + 24, duration: 0.32, ease: 'power3.inOut' }, keepSide ? at + 0.08 : at - 0.1);
      tl.set(el, { visibility: 'hidden' }, at + 0.3);
    };
    tl.set('[data-hero]', { visibility: 'hidden' }, AT.planner);
    leave('today', AT.planner);
    chapter('planner', AT.planner, 0);
    leave('planner', AT.meetings);
    const meet = chapter('meetings', AT.meetings, sw2, true);
    tl.fromTo($$('[data-pencil]', meet), { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.16, stagger: 0.07, ease: 'power2.out' }, AT.meetings + 0.34);
    leave('meetings', AT.notes, true);
    chapter('notes', AT.notes, sw2, false);
    leave('notes', AT.money, true);
    chapter('money', AT.money, sw, false);
    tl.to({}, { duration: 0.01 }, AT.end - 0.01);
    return { tl, place: 0, filed: false, paintClip };
  }

  function teardownStage() {
    if (!stage) return;
    stage.tl.scrollTrigger.kill();
    stage.tl.pause(0).kill();
    const els = $$('[data-w],[data-mk],[data-hero-fade],[data-paper],[data-side],[data-panel],[data-it],[data-scrim],[data-filed],[data-toast],[data-hero],[data-frame],[data-win],[data-over],.capture,.ch-screen,.ch-copy,.ch-copy p,.ch,.ch-main,.ch-pad,.ch-side,.ch-date,.scr-title,.sum,.shot,.enh,[data-pencil],[data-row] > *,.w');
    gsap.set(els, { clearProps: 'all' });
    stage = null;
  }

  function startStage() {
    stage = { place: 0, filed: false };
    const built = buildStage();
    stage = built;
    stage.paintClip();
    root.classList.add('staged');
    ScrollTrigger.refresh();
  }

  if (live) {
    const ready = document.fonts ? document.fonts.ready : Promise.resolve();
    ready.then(() => {
      startStage();
      if (location.hash) go(location.hash);
      // The pin's height is in svh, so a phone's address bar sliding away does not rebuild anything.
      let w = innerWidth, h = $('[data-pin]').offsetHeight, t;
      addEventListener('resize', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const pinH = $('[data-pin]').offsetHeight;
          if (innerWidth === w && pinH === h) return ScrollTrigger.refresh();
          w = innerWidth;
          h = pinH;
          const y = scrollY;
          teardownStage();
          window.scrollTo(0, 0);
          startStage();
          window.scrollTo(0, y);
          ScrollTrigger.refresh();
        }, 200);
      });
    });

    /* Statements ink in: pencil and soft, then ink */
    $$('[data-ink]').forEach(el => {
      if (el.id === 'say-title') return;
      const ws = inkWords(el);
      gsap.fromTo(ws, { opacity: 0.12, ...(isPhone() ? {} : { filter: 'blur(9px)' }) }, { opacity: 1, ...(isPhone() ? {} : { filter: 'blur(0px)' }), stagger: 0.12, ease: 'none',
        scrollTrigger: { trigger: el, start: 'top 88%', end: 'top 46%', scrub: true } });
    });

    /* The small jobs: each line is a to-do being ticked off, and then you see what came of it */
    $$('.job').forEach(row => {
      const ring = $('circle', row), tick = $('path', row), then = $('.job-done', row);
      gsap.set([ring, tick], { attr: { 'stroke-dasharray': '1 1' } });
      const tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: row, start: 'top 82%', end: 'top 52%', scrub: true } });
      tl.fromTo(ring, { attr: { 'stroke-dashoffset': 0.75 } }, { attr: { 'stroke-dashoffset': 0 }, duration: 0.4 }, 0)
        .fromTo(tick, { attr: { 'stroke-dashoffset': 1 } }, { attr: { 'stroke-dashoffset': 0 }, duration: 0.3 }, 0.34)
        .fromTo(then, { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.34 }, 0.5);
    });

    /* Section entrances: not the same fade everywhere */
    ['.jobs-sub', '.try-head p', '.private-sub', '.final-sub'].forEach(s => gsap.fromTo(s, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.8, ease: 'expo.out', scrollTrigger: { trigger: s, start: 'top 88%', once: true } }));
    gsap.from('.big-omni', { scale: 0.94, opacity: 0, duration: 0.9, ease: 'expo.out', scrollTrigger: { trigger: '.big-omni', start: 'top 90%', once: true }, clearProps: 'all' });
    gsap.from('.tries button', { y: 14, opacity: 0, duration: 0.6, ease: 'expo.out', stagger: 0.05, scrollTrigger: { trigger: '.tries', start: 'top 92%', once: true }, clearProps: 'all' });
    gsap.from('.cmd', { y: 30, opacity: 0, duration: 0.8, ease: 'expo.out', stagger: 0.06, scrollTrigger: { trigger: '.cmds', start: 'top 84%', once: true }, clearProps: 'opacity,transform' });
    gsap.from('.cmd-bg', { opacity: 0, duration: 0.6, ease: 'power2.out', scrollTrigger: { trigger: '.cmds', start: 'top 84%', once: true } });
    gsap.from('.edge-copy > p', { y: 16, opacity: 0, duration: 0.7, ease: 'expo.out', stagger: 0.08, scrollTrigger: { trigger: '.edge-copy', start: 'top 70%', once: true }, clearProps: 'all' });
    gsap.from('.facts li', { y: 20, opacity: 0, duration: 0.7, ease: 'expo.out', stagger: 0.06, scrollTrigger: { trigger: '.facts', start: 'top 86%', once: true }, clearProps: 'all' });
    gsap.from('.fact-mk', { scale: 0, duration: 0.5, ease: 'expo.out', stagger: 0.06, delay: 0.1, scrollTrigger: { trigger: '.facts', start: 'top 86%', once: true }, clearProps: 'all' });
    gsap.from('.models span', { y: 12, opacity: 0, duration: 0.6, ease: 'expo.out', stagger: 0.05, scrollTrigger: { trigger: '.models', start: 'top 92%', once: true }, clearProps: 'all' });

    /* The close: the pen stroke draws itself as the page ends */
    (function stroke() {
      const svg = $('[data-stroke]');
      if (!svg) return;
      const path = $('[data-stroke-path]', svg), spark = $('[data-stroke-spark]', svg);
      const len = path.getTotalLength();
      gsap.set(path, { attr: { 'stroke-dasharray': len, 'stroke-dashoffset': len } });
      gsap.set(spark, { transformOrigin: '50% 50%', scale: 0 });
      const tl = gsap.timeline({ scrollTrigger: { trigger: svg, start: 'top 92%', end: 'bottom bottom', scrub: true } });
      tl.to(path, { attr: { 'stroke-dashoffset': 0 }, ease: 'none', duration: 1 }).to(spark, { scale: 1, ease: 'back.out(2)', duration: 0.2 });
    })();

    /* Same notes, anywhere: one screen stays while the statements pass */
    (function anywhere() {
      const screens = $$('[data-screen]'), beats = $$('[data-beat]');
      const show = i => screens.forEach((s, k) => s.classList.toggle('is-on', k === i));
      const picks = $$('[data-theme-pick]');
      let theme = 2;
      const pick = i => { theme = i; picks.forEach(b => b.setAttribute('aria-pressed', +b.dataset.themePick === i)); show(i); };
      picks.forEach(b => b.addEventListener('click', () => pick(+b.dataset.themePick)));

      const mm = gsap.matchMedia();
      // Wide: the statements pass either side of the phone.
      mm.add('(min-width: 1181px)', () => {
        beats.forEach((b, i) => {
          ScrollTrigger.create({ trigger: b, start: 'top 60%', end: 'bottom 40%', onToggle: self => { if (self.isActive) show(i === 2 ? theme : i); } });
          gsap.from(b.children, { y: 20, opacity: 0, duration: 0.8, ease: 'expo.out', stagger: 0.08, scrollTrigger: { trigger: b, start: 'top 72%', once: true }, clearProps: 'all' });
        });
        gsap.from('[data-phone]', { y: 80, opacity: 0, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: '[data-anywhere]', start: 'top 72%', once: true }, clearProps: 'transform,opacity' });
      });
      // Narrow: there is no room beside the phone, so the words change in their own space above it.
      mm.add('(max-width: 1180px)', () => {
        let at = -1;
        const step = i => {
          if (i === at) return;
          at = i;
          beats.forEach((b, k) => b.classList.toggle('is-on', k === i));
          show(i === 2 ? theme : i);
        };
        step(0);
        ScrollTrigger.create({ trigger: '[data-anywhere]', start: 'top top', end: 'bottom bottom', onUpdate: self => step(Math.min(beats.length - 1, Math.floor(self.progress * beats.length))) });
        return () => beats.forEach(b => b.classList.remove('is-on'));
      });

      // The phone can be taller than its space: it starts on its top edge and rises to show the rest.
      const set = $('[data-handset]'), box = $('[data-phone]');
      const roomBelow = () => (matchMedia('(max-width: 1180px)').matches ? 0 : 28);
      gsap.to(set, { y: () => -Math.max(0, set.offsetHeight - box.offsetHeight + roomBelow()), ease: 'none',
        scrollTrigger: { trigger: '[data-anywhere]', start: 'top top', end: 'bottom bottom', scrub: true, invalidateOnRefresh: true } });
    })();
  } else {
    // Theme picker still works in plain flow.
    const screens = $$('[data-screen]');
    $$('[data-theme-pick]').forEach(b => b.addEventListener('click', () => {
      $$('[data-theme-pick]').forEach(x => x.setAttribute('aria-pressed', x === b));
      screens.forEach((s, k) => s.classList.toggle('is-on', k === +b.dataset.themePick));
    }));
  }

  /* ───────── The Edge Dock: the real tab, on the real edge ───────── */
  (function edgeDock() {
    const dock = $('[data-edge]');
    if (!dock) return;
    const section = $('[data-edge-section]'), openBtn = $('[data-edge-open]'), closeBtn = $('[data-edge-close]');
    const wide = () => live && matchMedia('(min-width: 901px)').matches;
    let userClosed = false;

    function shape() {
      const H = Math.min(760, innerHeight - px('--bar') - 16), D = H - 80;
      const W = 400, c = H / 2, T = c - D / 2, B = c + D / 2;
      dock.style.setProperty('--eh', `${H}px`);
      dock.style.setProperty('--dh', `${D}px`);
      const pth = (x, y) => `M${W} ${c - y - 14}A14 14 0 0 1 ${W - 14} ${c - y}L${x + 14} ${c - y}A14 14 0 0 0 ${x} ${c - y + 14}L${x} ${c + y - 14}A14 14 0 0 0 ${x + 14} ${c + y}L${W - 14} ${c + y}A14 14 0 0 1 ${W} ${c + y + 14}Z`;
      dock.style.setProperty('--path-tab', `path("${pth(W - 28, 34)}")`);
      dock.style.setProperty('--path-hover', `path("${pth(W - 40, 34)}")`);
      dock.style.setProperty('--path-open', `path("M${W} ${T - 28}A28 28 0 0 1 ${W - 28} ${T}L44 ${T}A28 28 0 0 0 16 ${T + 28}L16 ${B - 28}A28 28 0 0 0 44 ${B}L${W - 28} ${B}A28 28 0 0 1 ${W} ${B + 28}Z")`);
    }
    const setOpen = (open, focus) => {
      dock.classList.toggle('is-open', open);
      openBtn.setAttribute('aria-expanded', open);
      if (focus) (open ? closeBtn : openBtn).focus({ preventScroll: true });
    };

    if (wide()) {
      shape();
      addEventListener('resize', shape);
      ScrollTrigger.create({ trigger: section, start: 'top 72%', endTrigger: 'html', end: 'bottom bottom', toggleClass: { targets: dock, className: 'is-in' } });
      ScrollTrigger.create({ trigger: section, start: 'top 45%', end: 'bottom 55%',
        onToggle: self => { if (!userClosed) setOpen(self.isActive); } });
      openBtn.addEventListener('click', () => { userClosed = false; setOpen(true, true); });
      closeBtn.addEventListener('click', () => { userClosed = true; setOpen(false, true); });
      openBtn.addEventListener('pointerenter', () => dock.classList.add('is-hover'));
      openBtn.addEventListener('pointerleave', () => dock.classList.remove('is-hover'));
      openBtn.addEventListener('focus', () => dock.classList.add('is-hover'));
      openBtn.addEventListener('blur', () => dock.classList.remove('is-hover'));
      addEventListener('keydown', e => {
        if (e.key === 'Escape' && dock.classList.contains('is-open')) { userClosed = true; setOpen(false, true); }
        if (e.metaKey && e.shiftKey && (e.key === '.' || e.key === '>')) {
          e.preventDefault();
          dock.classList.add('is-in');
          userClosed = dock.classList.contains('is-open');
          setOpen(!dock.classList.contains('is-open'), true);
        }
      });
    }

    // It works: tick things off, or file a spend.
    const ticks = $$('[data-tick]');
    const C = 2 * Math.PI * 9.25;
    const total = ticks.length;
    const update = () => {
      const left = ticks.filter(t => t.getAttribute('aria-pressed') !== 'true').length;
      $$('[data-left]').forEach(el => { el.textContent = left; });
      $$('[data-ring]').forEach(r => r.setAttribute('style', `stroke-dasharray:${((total - left) / total) * C} ${C}`));
      $('[data-dock-line]').textContent = left ? `${left} left today` : 'All done today';
    };
    ticks.forEach(t => t.addEventListener('click', () => { t.setAttribute('aria-pressed', t.getAttribute('aria-pressed') !== 'true'); update(); }));
    update();

    let spent = 61000;
    const form = $('[data-dock-form]'), input = $('[data-dock-input]'), list = $('[data-dock-list]');
    form.addEventListener('submit', e => {
      e.preventDefault();
      understand(input.value).forEach(it => {
        const row = document.createElement('div');
        row.className = 'r';
        row.innerHTML = `<span class="tag tag-${it.kind}">${esc(it.tag)}</span><span class="bd"><span class="t">${esc(it.title)}</span></span><span class="r-tm">${esc(it.amt || it.where)}</span>`;
        list.prepend(row);
        if (it.n) { spent += it.n; $('[data-spent]').textContent = rupiah(spent); }
        if (live) gsap.from(row, { y: -8, opacity: 0, duration: 0.4, ease: 'expo.out', clearProps: 'all' });
      });
      input.value = '';
    });
  })();

  /* ───────── ⌘K: searches this site, and tries capturing ───────── */
  (function palette() {
    const dlg = $('[data-palette]');
    if (!dlg || !dlg.showModal) return;
    const input = $('[data-pal-input]'), body = $('[data-pal-body]');
    const PLACES = [
      ['Today', 'The page it opens on', '#today', 'i-today'],
      ['Planner', 'Tasks, meetings and bills', '#planner', 'i-planner'],
      ['Meetings', 'Record, transcribe, Enhance', '#meetings', 'i-wave'],
      ['Notes', 'A note keeps its tasks', '#notes', 'i-lines'],
      ['Money', 'Spending, budgets, split bills', '#money', 'i-money'],
      ['Small jobs', 'Receipts, reminders, voice memos', '#jobs', 'i-check'],
      ['Try the bar', 'Tell it something', '#bar', 'i-spark'],
      ['Edge Dock', 'Mac only', '#edge', 'i-arrow-ur'],
      ['Web app and sync', 'Any browser, one file in your Drive', '#web', 'i-cloud'],
      ['Privacy', 'One file on your Mac', '#private', 'i-note'],
      ['Download', 'Free for the Mac', '#download', 'i-apple'],
      ['Brand kit', 'Logo, colour and type', 'brand/', 'i-spark'],
    ];
    let matches = [], sel = 0;
    const paint = () => {
      const q = input.value.trim();
      const low = q.toLowerCase();
      matches = q ? PLACES.filter(p => (p[0] + ' ' + p[1]).toLowerCase().includes(low)) : PLACES;
      const items = q && !matches.length || (q && q.length > 3 && /\d|,|\s/.test(q)) ? understand(q) : [];
      sel = Math.min(sel, Math.max(matches.length - 1, 0));
      body.innerHTML = `
        ${items.length ? `<p class="pal-sec"><span>Capture · ${items.length === 1 ? '1 thing' : items.length + ' things'} found</span><span>A demo, nothing is saved</span></p>
          <ul class="pal-cap">${items.map(it => `<li class="row">${rowHTML(it)}</li>`).join('')}</ul>` : ''}
        ${matches.length ? `<p class="pal-sec"><span>Go to</span></p>` : ''}
        <div role="listbox" aria-label="Places on this page">${matches.map((p, i) => `<a class="pal-go" role="option" href="${p[2]}" aria-selected="${i === sel}"><span class="ri"><svg class="ico" aria-hidden="true"><use href="#${p[3]}"/></svg></span>${esc(p[0])}<small>${esc(p[1])}</small></a>`).join('')}</div>`;
    };
    const open = () => { if (dlg.open) return; lenis?.stop(); input.value = ''; sel = 0; paint(); dlg.showModal(); input.focus(); };
    const close = () => { if (dlg.open) dlg.close(); lenis?.start(); };
    dlg.addEventListener('close', () => lenis?.start());
    dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
    $$('[data-palette-open]').forEach(b => b.addEventListener('click', open));
    addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); dlg.open ? close() : open(); }
    });
    input.addEventListener('input', () => { sel = 0; paint(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!matches.length) return;
        sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
        $$('.pal-go', body).forEach((a, i) => { a.setAttribute('aria-selected', i === sel); if (i === sel) a.scrollIntoView({ block: 'nearest' }); });
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const a = $$('.pal-go', body)[sel];
        if (a) { close(); go(a.getAttribute('href')); }
      }
    });
    body.addEventListener('click', e => {
      const a = e.target.closest('.pal-go');
      if (!a) return;
      e.preventDefault();
      close();
      go(a.getAttribute('href'));
    });
  })();

  if (live) $('[data-side]').addEventListener('focusin', () => {
    const st = stage?.tl.scrollTrigger;
    if (!st) return;
    const showing = st.start + (st.end - st.start) * (1.3 / AT.end);
    if (scrollY < showing && st.isActive !== false) scrollTo(showing);
  });

  /* ───────── In-page links: a chapter is a moment in the stage, not a place in the document ───────── */
  function go(href) {
    if (!href.startsWith('#')) { location.href = href; return; }
    const id = href.slice(1);
    const chapters = { top: 0, today: 1.2, planner: AT.planner + 0.5, meetings: AT.meetings + 0.5, notes: AT.notes + 0.5, money: AT.money + 0.5 };
    if (live && stage && id in chapters) {
      const st = stage.tl.scrollTrigger;
      scrollTo(st.start + (st.end - st.start) * (chapters[id] / AT.end));
      return;
    }
    const el = document.getElementById(id);
    if (el) scrollTo(lenis ? el : el, { offset: -px('--bar') });
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.closest('.pal-go')) return;
    if (a.classList.contains('skip')) return;
    e.preventDefault();
    go(a.getAttribute('href'));
  });
})();
