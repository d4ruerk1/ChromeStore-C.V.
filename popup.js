'use strict';
const $ = (id) => document.getElementById(id);
const t = (k) => chrome.i18n.getMessage(k) || k;
const lang = chrome.i18n.getUILanguage();
document.documentElement.lang = lang;
document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
const pct = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat(lang, { maximumFractionDigits: 2 });
document.querySelectorAll('#spdChips button').forEach((b) => { b.textContent = num.format(b.dataset.v / 100) + '×'; });
document.querySelectorAll('#volChips button[data-v]:not([data-v="0"])').forEach((b) => { b.textContent = pct.format(b.dataset.v / 100); });

const RESTRICTED = /^(chrome|edge|brave|opera|vivaldi|about|devtools|view-source|chrome-extension|chrome-search|chrome-untrusted|chrome-error):|^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i;
const vol = $('vol'), spd = $('spd');
let tabId = null;

const paint = (el) => el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min)) * 100 + '%');
const mark = (box, v) => box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.v === v));
function note(el, text, warn) { el.hidden = !text; el.textContent = text || ''; el.classList.toggle('warn', !!warn); }

// Coalesce rapid slider events: at most one request in flight, always ends on the latest value.
function coalesce(fn) {
  let busy = false, next = null;
  return async function run(arg) {
    next = arg;
    if (busy) return;
    busy = true;
    while (next !== null) { const a = next; next = null; try { await fn(a); } catch (_) {} }
    busy = false;
  };
}

/* ---------- Volume ---------- */
function showVol(v) {
  vol.value = v; paint(vol);
  const boost = v > 100;
  vol.classList.toggle('boost', boost); $('volOut').classList.toggle('boost', boost);
  $('volOut').textContent = pct.format(v / 100);
  vol.setAttribute('aria-valuetext', pct.format(v / 100));
  mark($('volChips'), v);
  note($('volNote'), boost ? t('boostWarning') : '', true);
}
const sendVol = coalesce(async ({ v, final }) => {
  const r = await chrome.runtime.sendMessage({ type: 'setVolume', tabId, vol: v, final }).catch(() => null);
  if (!r || !r.ok) { note($('volNote'), t('captureError'), true); showVolSafe(100); }
});
function showVolSafe(v) { const n = $('volNote').textContent; showVol(v); note($('volNote'), n, true); }
const setVol = (v, final) => { showVol(v); sendVol({ v, final }); };
vol.addEventListener('input', () => setVol(+vol.value, false));
vol.addEventListener('change', () => setVol(+vol.value, true));
$('volChips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setVol(+b.dataset.v, true); });

/* ---------- Speed (injected on demand, no permanent content scripts) ---------- */
function pageApplyRate(rate) {
  const st = (window.__cvRate ||= { r: 1, on: false });
  st.r = rate;
  const media = [];
  const walk = (root) => {
    root.querySelectorAll('video,audio').forEach((m) => media.push(m));
    root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot); });
  };
  walk(document);
  const set = (m) => { if (Math.abs(m.playbackRate - st.r) > 0.001) { try { m.playbackRate = st.r; } catch (_) {} } };
  media.forEach(set);
  if (!st.on) {
    st.on = true; // keep the chosen speed when the site swaps sources or resets it
    const h = (e) => { if (e.target instanceof HTMLMediaElement && st.r !== 1) set(e.target); };
    ['play', 'loadedmetadata', 'ratechange'].forEach((ev) => document.addEventListener(ev, h, true));
  }
  return media.length;
}
function pageProbe() {
  const media = [];
  const walk = (root) => {
    root.querySelectorAll('video,audio').forEach((m) => media.push(m));
    root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot); });
  };
  walk(document);
  const m = media.find((x) => !x.paused) || media[0];
  return { n: media.length, playing: !!(m && !m.paused), rate: m ? m.playbackRate : null };
}
async function exec(func, args = []) {
  try { return await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func, args }); }
  catch (_) { return chrome.scripting.executeScript({ target: { tabId }, func, args }); }
}
function showSpd(p) {
  spd.value = p; paint(spd);
  $('spdOut').textContent = num.format(p / 100) + '×';
  spd.setAttribute('aria-valuetext', num.format(p / 100) + '×');
  mark($('spdChips'), p);
}
const sendSpd = coalesce(async (p) => {
  try {
    const res = await exec(pageApplyRate, [p / 100]);
    const n = res.reduce((a, x) => a + (x.result || 0), 0);
    note($('spdNote'), n ? '' : t('noMedia'));
  } catch (_) { note($('spdNote'), t('speedError'), true); }
});
const setSpd = (p) => { p = Math.min(400, Math.max(10, Math.round(p / 5) * 5)); showSpd(p); sendSpd(p); };
spd.addEventListener('input', () => setSpd(+spd.value));
$('spdChips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setSpd(+b.dataset.v); });

$('reset').addEventListener('click', () => { setVol(100, true); setSpd(100); });

/* ---------- Init ---------- */
(async () => {
  showVol(100); showSpd(100);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  tabId = tab.id;
  if (RESTRICTED.test(tab.url || '')) {
    $('restricted').hidden = false; $('main').classList.add('off'); $('reset').disabled = true;
    return;
  }
  const s = await chrome.runtime.sendMessage({ type: 'get', tabId }).catch(() => null);
  if (s && s.ok) showVol(s.vol);
  try {
    const res = (await exec(pageProbe)).map((x) => x.result).filter((r) => r && r.n);
    const best = res.find((r) => r.playing) || res[0];
    if (best && best.rate) showSpd(Math.min(400, Math.max(10, Math.round(best.rate * 20) * 5)));
    else note($('spdNote'), t('noMedia'));
  } catch (_) { note($('spdNote'), t('speedError'), true); }
})();
