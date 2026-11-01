'use strict';

// Cross-browser API
const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const $ = (id) => document.getElementById(id);
const t = (k) => api.i18n.getMessage(k) || k;
const lang = api.i18n.getUILanguage ? api.i18n.getUILanguage() : (navigator.language || 'en');
document.documentElement.lang = lang;

// i18n for text content and titles
document.querySelectorAll('[data-i18n]').forEach((el) => {
  const msg = t(el.dataset.i18n);
  if (msg) el.textContent = msg;
});
document.querySelectorAll('[data-i18n-title]').forEach((el) => {
  const msg = t(el.dataset.i18nTitle);
  if (msg) el.title = el.ariaLabel = msg;
});

const pct = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat(lang, { maximumFractionDigits: 2 });

document.querySelectorAll('#spdChips button').forEach((b) => {
  b.textContent = num.format(+b.dataset.v / 100) + '×';
});
document.querySelectorAll('#volChips button[data-v]:not([data-v="0"])').forEach((b) => {
  b.textContent = pct.format(+b.dataset.v / 100);
});

const RESTRICTED = /^(chrome|edge|brave|opera|vivaldi|about|devtools|view-source|chrome-extension|moz-extension|chrome-search|chrome-untrusted|chrome-error):|^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i;

const vol = $('vol'), spd = $('spd');
let tabId = null;
let hideBoostWarn = false;

const paint = (el) => el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min)) * 100 + '%');
const mark = (box, v) => box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.v === v));
function note(el, text, warn) { el.hidden = !text; el.textContent = text || ''; el.classList.toggle('warn', !!warn); }

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

function throttle(fn, wait = 40) {
  let timer = null;
  let lastArgs = null;
  return function throttled(...args) {
    lastArgs = args;
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        if (lastArgs) {
          const a = lastArgs;
          lastArgs = null;
          fn(...a);
        }
      }, wait);
      fn(...args);
    }
  };
}

/* ---------- Navigation: Home vs Settings view ---------- */
const settingsBtn = $('settingsBtn');
const settingsBackBtn = $('settingsBackBtn');
const settingsPanel = $('settingsPanel');
const mainEl = $('main');
const resetBtn = $('reset');
const coffeeBtn = $('coffeeBtn');
const headerTitle = $('headerTitle');

function setView(isSettings) {
  settingsPanel.hidden = !isSettings;
  mainEl.hidden = isSettings;
  settingsBtn.classList.toggle('active', isSettings);
  resetBtn.style.display = isSettings ? 'none' : '';
  coffeeBtn.style.display = isSettings ? 'none' : '';
  headerTitle.textContent = isSettings ? (t('settingsTitle') || 'Settings') : 'C.V.';
}

settingsBtn.addEventListener('click', () => {
  setView(settingsPanel.hidden);
});

if (settingsBackBtn) {
  settingsBackBtn.addEventListener('click', () => {
    setView(false);
  });
}

/* ---------- Settings panel controls ---------- */
const rememberCheckbox = $('rememberVol');
if (rememberCheckbox) {
  api.storage.local.get({ rememberVol: true }).then((data) => {
    rememberCheckbox.checked = !!data.rememberVol;
  }).catch(() => {});
  rememberCheckbox.addEventListener('change', () => {
    api.storage.local.set({ rememberVol: rememberCheckbox.checked }).catch(() => {});
  });
}

const notifyCheckbox = $('notifyUpdates');
if (notifyCheckbox) {
  api.storage.local.get({ notifyUpdates: true }).then((data) => {
    notifyCheckbox.checked = !!data.notifyUpdates;
  }).catch(() => {});
  notifyCheckbox.addEventListener('change', () => {
    api.storage.local.set({ notifyUpdates: notifyCheckbox.checked }).catch(() => {});
    if (notifyCheckbox.checked) {
      api.runtime.sendMessage({ type: 'checkUpdateNow' }).catch(() => {});
    }
  });
}

// Check for update notifications
api.storage.local.get(['updateAvailable', 'updateUrl']).then((data) => {
  if (data.updateAvailable && $('updateBanner')) {
    $('updateBanner').hidden = false;
    $('updateVersionText').textContent = 'v' + data.updateAvailable + ' ' + (t('updateAvailable') || 'available!');
    if (data.updateUrl && $('updateLink')) $('updateLink').href = data.updateUrl;
  }
}).catch(() => {});

/* ---------- Coffee / Donation buttons ---------- */
const openDonate = () => api.tabs.create({ url: 'https://ko-fi.com/d4ruerk1' });
coffeeBtn.addEventListener('click', openDonate);
$('settingsDonateBtn').addEventListener('click', openDonate);

/* ---------- Volume ---------- */
const volNoteBox = $('volNoteBox');
const dismissVolNote = $('dismissVolNote');
const volErrorNote = $('volErrorNote');

api.storage.local.get({ hideBoostWarn: false }).then((data) => {
  hideBoostWarn = !!data.hideBoostWarn;
  if (hideBoostWarn && volNoteBox) volNoteBox.hidden = true;
}).catch(() => {});

if (dismissVolNote) {
  dismissVolNote.addEventListener('click', () => {
    hideBoostWarn = true;
    volNoteBox.hidden = true;
    api.storage.local.set({ hideBoostWarn: true }).catch(() => {});
  });
}

function showVol(v) {
  vol.value = v; paint(vol);
  const boost = v > 100;
  vol.classList.toggle('boost', boost);
  $('volOut').classList.toggle('boost', boost);
  $('volOut').textContent = pct.format(v / 100);
  vol.setAttribute('aria-valuetext', pct.format(v / 100));
  mark($('volChips'), v);
  if (volNoteBox) {
    volNoteBox.hidden = !boost || hideBoostWarn;
  }
}

const sendVol = coalesce(async ({ v, final }) => {
  const r = await api.runtime.sendMessage({ type: 'setVolume', tabId, vol: v, final }).catch(() => null);
  if (!r || !r.ok) {
    note(volErrorNote, t('captureError'), true);
    showVol(100);
  } else {
    note(volErrorNote, '', false);
  }
});

const setVol = (v, final) => { showVol(v); sendVol({ v, final }); };

vol.addEventListener('input', () => setVol(+vol.value, false));
vol.addEventListener('change', () => setVol(+vol.value, true));
$('volChips').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (b) setVol(+b.dataset.v, true);
});

/* ---------- Speed (starts at 0.25x = 25, max 5x = 500) ---------- */
function pageApplyRate(rate) {
  const st = (window.__cvRate ||= { r: 1, on: false, setting: false, lastSet: 0 });
  st.r = rate;

  function getMedia() {
    let list = Array.from(document.querySelectorAll('video, audio'));
    if (list.length === 0) {
      const hosts = document.querySelectorAll('*');
      for (let i = 0; i < hosts.length; i++) {
        const sr = hosts[i].shadowRoot;
        if (sr) {
          const inner = sr.querySelectorAll('video, audio');
          for (let j = 0; j < inner.length; j++) list.push(inner[j]);
        }
      }
    }
    return list;
  }

  const media = getMedia();
  const set = (m) => {
    if (st.setting) return;
    if (Math.abs(m.playbackRate - st.r) > 0.001) {
      const now = Date.now();
      if (m.__cvLastSet && now - m.__cvLastSet < 150) return;
      m.__cvLastSet = now;
      try {
        st.setting = true;
        m.playbackRate = st.r;
      } catch (_) {
      } finally {
        st.setting = false;
      }
    }
  };

  media.forEach(set);

  if (!st.on) {
    st.on = true;
    const h = (e) => {
      if (e.target instanceof HTMLMediaElement && st.r !== 1) {
        set(e.target);
      }
    };
    ['play', 'loadedmetadata', 'ratechange'].forEach((ev) => {
      document.addEventListener(ev, h, true);
    });
  }

  return media.length;
}

function pageProbe() {
  let media = Array.from(document.querySelectorAll('video, audio'));
  if (media.length === 0) {
    const hosts = document.querySelectorAll('*');
    for (let i = 0; i < hosts.length; i++) {
      const sr = hosts[i].shadowRoot;
      if (sr) {
        const inner = sr.querySelectorAll('video, audio');
        for (let j = 0; j < inner.length; j++) media.push(inner[j]);
      }
    }
  }
  const m = media.find((x) => !x.paused) || media[0];
  return { n: media.length, playing: !!(m && !m.paused), rate: m ? m.playbackRate : null };
}

async function exec(func, args = []) {
  try { return await api.scripting.executeScript({ target: { tabId, allFrames: true }, func, args }); }
  catch (_) { return api.scripting.executeScript({ target: { tabId }, func, args }); }
}

function showSpd(p) {
  spd.value = p; paint(spd);
  $('spdOut').textContent = num.format(p / 100) + '×';
  spd.setAttribute('aria-valuetext', num.format(p / 100) + '×');
  mark($('spdChips'), p);
}

const sendSpdImmediate = coalesce(async (p) => {
  try {
    const res = await exec(pageApplyRate, [p / 100]);
    const n = res.reduce((a, x) => a + (x.result || 0), 0);
    note($('spdNote'), n ? '' : t('noMedia'));
  } catch (_) { note($('spdNote'), t('speedError'), true); }
});

const sendSpdThrottled = throttle(sendSpdImmediate, 40);

const setSpd = (p, immediate = false) => {
  p = Math.min(500, Math.max(25, Math.round(p / 5) * 5));
  showSpd(p);
  if (immediate) sendSpdImmediate(p);
  else sendSpdThrottled(p);
};

spd.addEventListener('input', () => setSpd(+spd.value, false));
spd.addEventListener('change', () => setSpd(+spd.value, true));
$('spdChips').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (b) setSpd(+b.dataset.v, true);
});

$('reset').addEventListener('click', () => { setVol(100, true); setSpd(100, true); });

/* ---------- Init ---------- */
(async () => {
  showVol(100); showSpd(100);
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || tab.id == null) return;
  tabId = tab.id;
  if (RESTRICTED.test(tab.url || '')) {
    $('restricted').hidden = false;
    $('main').classList.add('off');
    $('reset').disabled = true;
    return;
  }
  const s = await api.runtime.sendMessage({ type: 'get', tabId }).catch(() => null);
  if (s && s.ok) showVol(s.vol);
  try {
    const res = (await exec(pageProbe)).map((x) => x.result).filter((r) => r && r.n);
    const best = res.find((r) => r.playing) || res[0];
    if (best && best.rate) showSpd(Math.min(500, Math.max(25, Math.round(best.rate * 20) * 5)));
    else note($('spdNote'), t('noMedia'));
  } catch (_) { note($('spdNote'), t('speedError'), true); }
})();
