'use strict';

// Cross-browser API shim
const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const $ = (id) => document.getElementById(id);
let activeDict = {};
let currentLocale = 'en';
let pct = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 0 });
let num = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });

function t(k) {
  if (activeDict && activeDict[k] && activeDict[k].message) {
    return activeDict[k].message;
  }
  return api.i18n.getMessage(k) || k;
}

const RESTRICTED = /^(chrome|edge|brave|opera|vivaldi|about|devtools|view-source|chrome-extension|moz-extension|chrome-search|chrome-untrusted|chrome-error):|^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i;

const vol = $('vol'), spd = $('spd');
let tabId = null;
let hideBoostWarn = false;
let lastNonZeroVol = 100;

const paint = (el) => el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min)) * 100 + '%');
const mark = (box, v) => box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.v === v));
function note(el, text, warn) { if (el) { el.hidden = !text; el.textContent = text || ''; el.classList.toggle('warn', !!warn); } }

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

function throttle(fn, wait = 30) {
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

/* ---------- Active Tab Resolution (robust for all environments/Linux) ---------- */
async function getActiveTab() {
  try {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0] && tabs[0].id != null) return tabs[0];
  } catch (_) {}
  try {
    const tabs = await api.tabs.query({ active: true, lastFocusedWindow: true });
    if (tabs && tabs[0] && tabs[0].id != null) return tabs[0];
  } catch (_) {}
  try {
    const tabs = await api.tabs.query({ active: true });
    const normal = tabs.find((t) => t.id != null && (!t.url || !t.url.startsWith('chrome-extension://')));
    if (normal) return normal;
    if (tabs && tabs[0] && tabs[0].id != null) return tabs[0];
  } catch (_) {}
  return null;
}

// Start tab discovery immediately at the top
const tabReadyPromise = (async () => {
  const tab = await getActiveTab();
  if (tab && tab.id != null) {
    tabId = tab.id;
  }
  return tab;
})();

let currentStreamId = null;

function requestStreamId(tId) {
  return new Promise((resolve) => {
    try {
      if (api.tabCapture && api.tabCapture.getMediaStreamId) {
        api.tabCapture.getMediaStreamId({ targetTabId: tId }, (id) => {
          if (api.runtime.lastError || !id) resolve(null);
          else resolve(id);
        });
      } else {
        resolve(null);
      }
    } catch (_) {
      resolve(null);
    }
  });
}

/* ---------- Script Execution in Tab (world: 'MAIN' with fallbacks) ---------- */
async function exec(func, args = []) {
  if (!tabId) {
    const tab = await getActiveTab();
    if (tab && tab.id != null) tabId = tab.id;
  }
  if (tabId == null) return [];

  // Run in top frame first (fastest and most reliable)
  let topRes = [];
  try {
    topRes = await api.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func,
      args
    });
  } catch (_) {
    try {
      topRes = await api.scripting.executeScript({
        target: { tabId },
        func,
        args
      });
    } catch (_) {}
  }

  // Also run in child frames (e.g. embedded players)
  try {
    const allRes = await api.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func,
      args
    });
    if (allRes && allRes.length > 0) return allRes;
  } catch (_) {
    try {
      const allRes = await api.scripting.executeScript({
        target: { tabId, allFrames: true },
        func,
        args
      });
      if (allRes && allRes.length > 0) return allRes;
    } catch (_) {}
  }

  return topRes;
}

/* ---------- Direct Page Media Scripts ---------- */
function pageApplyVolume(volVal, isCaptured) {
  const v = Math.max(0, Math.min(500, volVal));
  const norm = Math.max(0, Math.min(1, v / 100));

  function findAllMedia(root) {
    let list = [];
    if (!root) return list;
    try {
      const media = root.querySelectorAll('video, audio');
      for (let i = 0; i < media.length; i++) list.push(media[i]);
    } catch (_) {}
    try {
      const all = root.querySelectorAll('*');
      for (let i = 0; i < all.length; i++) {
        if (all[i].shadowRoot) list = list.concat(findAllMedia(all[i].shadowRoot));
      }
    } catch (_) {}
    return list;
  }

  const media = findAllMedia(document);

  // 1. Native media volume & mute
  for (let i = 0; i < media.length; i++) {
    try {
      media[i].volume = norm;
      media[i].muted = (v === 0);
    } catch (_) {}
  }

  // 2. YouTube native player API
  try {
    const yt = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (yt) {
      if (v === 0 && typeof yt.mute === 'function') yt.mute();
      else if (typeof yt.unMute === 'function') yt.unMute();
      if (typeof yt.setVolume === 'function') yt.setVolume(Math.min(100, v));
    }
  } catch (_) {}

  // 3. In-page Web Audio fallback with automatic balancing filters if tabCapture is not active and v > 100
  if (!isCaptured && v > 100) {
    const boost = v / 100;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        window.__cvAudioCtx = window.__cvAudioCtx || new AudioContextClass();
        const ctx = window.__cvAudioCtx;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});

        for (let i = 0; i < media.length; i++) {
          const el = media[i];
          if (!el.__cvSource) {
            try {
              el.__cvSource = ctx.createMediaElementSource(el);

              // High-pass filter (80 Hz) to cut sub-bass rattle
              el.__cvHp = ctx.createBiquadFilter();
              el.__cvHp.type = 'highpass';
              el.__cvHp.frequency.value = 80;

              // Clarity EQ (2.5 kHz) for voice presence
              el.__cvEq = ctx.createBiquadFilter();
              el.__cvEq.type = 'peaking';
              el.__cvEq.frequency.value = 2500;
              el.__cvEq.gain.value = 2.0;

              el.__cvGain = ctx.createGain();

              // Smooth automatic dynamics compressor
              el.__cvLimiter = ctx.createDynamicsCompressor();
              el.__cvLimiter.threshold.value = -6;
              el.__cvLimiter.knee.value = 12;
              el.__cvLimiter.ratio.value = 3.5;
              el.__cvLimiter.attack.value = 0.003;
              el.__cvLimiter.release.value = 0.18;

              el.__cvSource.connect(el.__cvHp);
              el.__cvHp.connect(el.__cvEq);
              el.__cvEq.connect(el.__cvGain);
              el.__cvGain.connect(el.__cvLimiter);
              el.__cvLimiter.connect(ctx.destination);
            } catch (_) {}
          }
          if (el.__cvGain) {
            try {
              el.__cvGain.gain.setTargetAtTime(boost, ctx.currentTime, 0.015);
            } catch (_) {
              try { el.__cvGain.gain.value = boost; } catch (_) {}
            }
          }
        }
      }
    } catch (_) {}
  } else if (isCaptured) {
    // Keep in-page gain neutral (1.0) when tabCapture is active to avoid double boost
    try {
      if (window.__cvAudioCtx) {
        for (let i = 0; i < media.length; i++) {
          if (media[i].__cvGain) {
            media[i].__cvGain.gain.setTargetAtTime(1.0, window.__cvAudioCtx.currentTime, 0.015);
          }
        }
      }
    } catch (_) {}
  }

  // Auto-enforce volume on newly loaded or playing videos
  window.__cvTargetVol = v;
  window.__cvIsCaptured = isCaptured;
  if (!window.__cvVolEnforcer) {
    window.__cvVolEnforcer = true;
    let updating = false;
    const reapply = () => {
      if (updating) return;
      if (typeof window.__cvTargetVol === 'number') {
        try {
          updating = true;
          pageApplyVolume(window.__cvTargetVol, window.__cvIsCaptured);
        } catch (_) {
        } finally {
          updating = false;
        }
      }
    };
    ['play', 'playing', 'loadedmetadata'].forEach((ev) => {
      document.addEventListener(ev, reapply, true);
    });
  }

  return media.length;
}

function pageApplyRate(rate) {
  window.__cvRate = rate;

  function findAllMedia(root) {
    let list = [];
    if (!root) return list;
    try {
      const media = root.querySelectorAll('video, audio');
      for (let i = 0; i < media.length; i++) list.push(media[i]);
    } catch (_) {}
    try {
      const all = root.querySelectorAll('*');
      for (let i = 0; i < all.length; i++) {
        if (all[i].shadowRoot) list = list.concat(findAllMedia(all[i].shadowRoot));
      }
    } catch (_) {}
    return list;
  }

  const media = findAllMedia(document);
  for (let i = 0; i < media.length; i++) {
    try {
      media[i].playbackRate = rate;
      media[i].defaultPlaybackRate = rate;
    } catch (_) {}
  }

  try {
    const yt = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (yt && typeof yt.setPlaybackRate === 'function') {
      yt.setPlaybackRate(rate);
    }
  } catch (_) {}

  if (!window.__cvRateEnforcer) {
    window.__cvRateEnforcer = true;
    let updating = false;

    const enforce = (e) => {
      if (updating) return;
      const target = e.target;
      if (target && (target.tagName === 'VIDEO' || target.tagName === 'AUDIO')) {
        const targetRate = window.__cvRate;
        if (typeof targetRate === 'number' && Math.abs(target.playbackRate - targetRate) > 0.01) {
          try {
            updating = true;
            target.playbackRate = targetRate;
            target.defaultPlaybackRate = targetRate;
          } catch (_) {
          } finally {
            updating = false;
          }
        }
      }
    };

    ['ratechange', 'play', 'playing', 'loadedmetadata', 'loadstart', 'canplay'].forEach((ev) => {
      document.addEventListener(ev, enforce, true);
    });
  }

  return media.length;
}

function pageProbe() {
  function findAllMedia(root) {
    let list = [];
    if (!root) return list;
    try {
      const media = root.querySelectorAll('video, audio');
      for (let i = 0; i < media.length; i++) list.push(media[i]);
    } catch (_) {}
    try {
      const all = root.querySelectorAll('*');
      for (let i = 0; i < all.length; i++) {
        if (all[i].shadowRoot) list = list.concat(findAllMedia(all[i].shadowRoot));
      }
    } catch (_) {}
    return list;
  }

  const media = findAllMedia(document);
  if (typeof window.__cvRate === 'number') {
    return { n: media.length, rate: window.__cvRate, playing: true };
  }
  const playing = media.find((m) => !m.paused);
  const m = playing || media[0];
  return { n: media.length, rate: m ? m.playbackRate : 1, playing: !!playing };
}

/* ---------- Internationalization & Language Switcher ---------- */
const langSelect = $('langSelect');

async function applyLanguage(langCode) {
  let effective = langCode;
  if (!effective || effective === 'auto') {
    effective = api.i18n.getUILanguage ? api.i18n.getUILanguage() : (navigator.language || 'en');
  }
  effective = effective.toLowerCase();

  let folder = 'en';
  if (effective.startsWith('zh')) folder = 'zh_CN';
  else if (effective.startsWith('ja')) folder = 'ja';
  else if (effective.startsWith('ru')) folder = 'ru';
  else if (effective.startsWith('ar')) folder = 'ar';
  else if (effective.startsWith('it')) folder = 'it';
  else if (effective.startsWith('de')) folder = 'de';
  else if (effective.startsWith('es')) folder = 'es';
  else if (effective.startsWith('fr')) folder = 'fr';
  else folder = 'en';

  currentLocale = folder;
  document.documentElement.lang = folder.replace('_', '-');
  document.documentElement.dir = (folder === 'ar') ? 'rtl' : 'ltr';

  try {
    const url = api.runtime.getURL(`_locales/${folder}/messages.json`);
    const res = await fetch(url);
    if (res.ok) {
      activeDict = await res.json();
    }
  } catch (_) {
    activeDict = {};
  }

  const intlLocale = folder === 'zh_CN' ? 'zh-CN' : folder;
  pct = new Intl.NumberFormat(intlLocale, { style: 'percent', maximumFractionDigits: 0 });
  num = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 2 });

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const msg = t(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const msg = t(el.dataset.i18nTitle);
    if (msg) el.title = el.ariaLabel = msg;
  });

  document.querySelectorAll('#spdChips button').forEach((b) => {
    b.textContent = num.format(+b.dataset.v / 100) + '×';
  });
  document.querySelectorAll('#volChips button[data-v]').forEach((b) => {
    b.textContent = pct.format(+b.dataset.v / 100);
  });

  if (vol) {
    const v = +vol.value;
    if ($('volOut')) $('volOut').textContent = pct.format(v / 100);
    vol.setAttribute('aria-valuetext', pct.format(v / 100));
    updateMuteIcon(v);
  }
  if (spd) {
    const p = +spd.value;
    if ($('spdOut')) $('spdOut').textContent = num.format(p / 100) + '×';
    spd.setAttribute('aria-valuetext', num.format(p / 100) + '×');
  }

  if (langSelect) {
    langSelect.value = langCode || 'auto';
  }

  api.storage.local.set({ userLang: langCode || 'auto' }).catch(() => {});
}

if (langSelect) {
  langSelect.addEventListener('change', () => {
    applyLanguage(langSelect.value);
  });
}

api.storage.local.get({ userLang: 'auto' }).then((data) => {
  applyLanguage(data.userLang || 'auto');
}).catch(() => {
  applyLanguage('auto');
});

/* ---------- Navigation: Main vs Settings view ---------- */
const settingsBtn = $('settingsBtn');
const homeBtn = $('homeBtn');
const settingsPanel = $('settingsPanel');
const mainEl = $('main');
const coffeeBtn = $('coffeeBtn');

function setView(isSettings) {
  settingsPanel.hidden = !isSettings;
  settingsPanel.style.display = isSettings ? 'block' : 'none';
  mainEl.hidden = isSettings;
  mainEl.style.display = isSettings ? 'none' : 'block';
  settingsBtn.style.display = isSettings ? 'none' : 'inline-flex';
  homeBtn.style.display = isSettings ? 'inline-flex' : 'none';
}

settingsBtn.addEventListener('click', () => setView(true));
homeBtn.addEventListener('click', () => setView(false));

const openDonate = () => api.tabs.create({ url: 'https://ko-fi.com/d4ruerk1' });
coffeeBtn.addEventListener('click', openDonate);

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

const shortcutsBtn = $('shortcutsBtn');
if (shortcutsBtn) {
  shortcutsBtn.addEventListener('click', () => {
    api.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
  shortcutsBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      api.tabs.create({ url: 'chrome://extensions/shortcuts' });
    }
  });
}

/* ---------- Version comparison & Update checker ---------- */
function isNewerVersion(remote, local) {
  const clean = (v) => String(v || '').replace(/^v/i, '').trim().split(/[-+]/)[0];
  const rParts = clean(remote).split('.').map((n) => parseInt(n, 10) || 0);
  const lParts = clean(local).split('.').map((n) => parseInt(n, 10) || 0);
  const maxLen = Math.max(rParts.length, lParts.length);
  for (let i = 0; i < maxLen; i++) {
    const r = rParts[i] || 0;
    const l = lParts[i] || 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return false;
}

const updateDownloadBtn = $('updateDownloadBtn');

function refreshUpdateBtn() {
  const currentVer = api.runtime.getManifest().version;
  api.storage.local.get(['updateAvailable', 'updateUrl']).then((data) => {
    const hasNewer = data.updateAvailable && isNewerVersion(data.updateAvailable, currentVer);
    if (!hasNewer) {
      if (data.updateAvailable) {
        api.storage.local.remove(['updateAvailable', 'updateUrl']).catch(() => {});
      }
      if (updateDownloadBtn) {
        updateDownloadBtn.hidden = true;
        updateDownloadBtn.style.display = 'none';
      }
      return;
    }
    if (updateDownloadBtn) {
      updateDownloadBtn.hidden = false;
      updateDownloadBtn.style.display = 'inline-flex';
      updateDownloadBtn.title = (t('updateAvailableTitle') || 'Aggiornamento disponibile') + ': v' + data.updateAvailable;
    }
  }).catch(() => {});
}

if (updateDownloadBtn) {
  updateDownloadBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const data = await api.storage.local.get(['updateUrl']).catch(() => ({}));
    const url = data.updateUrl || 'https://github.com/d4ruerk1/ChromeStore-C.V/releases';
    api.tabs.create({ url });
  });
}

refreshUpdateBtn();
api.runtime.sendMessage({ type: 'checkUpdate', force: false }).catch(() => {});

/* ---------- Volume Controls ---------- */
const volNoteBox = $('volNoteBox');
const dismissVolNote = $('dismissVolNote');
const volErrorNote = $('volErrorNote');
const muteBtn = $('muteBtn');
const volOut = $('volOut');
const volInput = $('volInput');

function updateMuteIcon(v) {
  if (!muteBtn) return;
  muteBtn.classList.toggle('muted', v === 0);
  muteBtn.classList.toggle('boost', v > 100);

  let iconSvg = '';
  if (v === 0) {
    iconSvg = `<svg class="mute-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="9 5 5 9 2 9 2 15 5 15 9 19 9 5"></polygon>
      <line x1="22" y1="9" x2="16" y2="15"></line>
      <line x1="16" y1="9" x2="22" y2="15"></line>
    </svg>`;
    muteBtn.title = t('unmute') || 'Riattiva audio';
  } else if (v <= 66) {
    iconSvg = `<svg class="mute-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="9 5 5 9 2 9 2 15 5 15 9 19 9 5"></polygon>
      <path d="M13 9a4 4 0 0 1 0 6"></path>
    </svg>`;
    muteBtn.title = t('mute') || 'Muto';
  } else if (v <= 100) {
    iconSvg = `<svg class="mute-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="9 5 5 9 2 9 2 15 5 15 9 19 9 5"></polygon>
      <path d="M13 9a4 4 0 0 1 0 6"></path>
      <path d="M16 6.5a8 8 0 0 1 0 11"></path>
    </svg>`;
    muteBtn.title = t('mute') || 'Muto';
  } else {
    iconSvg = `<svg class="mute-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="9 5 5 9 2 9 2 15 5 15 9 19 9 5"></polygon>
      <path d="M13 9a4 4 0 0 1 0 6"></path>
      <path d="M16 6.5a8 8 0 0 1 0 11"></path>
      <path d="M19 4a12 12 0 0 1 0 16"></path>
    </svg>`;
    muteBtn.title = t('mute') || 'Muto';
  }
  muteBtn.innerHTML = iconSvg;
}

function updateBoostWarn(v) {
  if (!volNoteBox) return;
  const isBoost = v > 100;
  const shouldShow = isBoost && !hideBoostWarn;
  volNoteBox.hidden = !shouldShow;
  volNoteBox.style.display = shouldShow ? 'flex' : 'none';
}

api.storage.local.get({ hideBoostWarn: false }).then((data) => {
  hideBoostWarn = !!data.hideBoostWarn;
  updateBoostWarn(+vol.value);
}).catch(() => {});

if (dismissVolNote) {
  dismissVolNote.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideBoostWarn = true;
    updateBoostWarn(+vol.value);
    api.storage.local.set({ hideBoostWarn: true }).catch(() => {});
  });
}

function showVol(v) {
  vol.value = v;
  paint(vol);
  const boost = v > 100;
  vol.classList.toggle('boost', boost);

  if (volOut) {
    volOut.classList.toggle('boost', boost);
    volOut.textContent = pct.format(v / 100);
  }
  if (volInput) {
    volInput.value = v;
  }
  vol.setAttribute('aria-valuetext', pct.format(v / 100));
  mark($('volChips'), v);

  updateMuteIcon(v);
  updateBoostWarn(v);
}

const sendVol = coalesce(async ({ v, final }) => {
  if (!tabId) {
    const tab = await getActiveTab();
    if (tab && tab.id != null) tabId = tab.id;
  }
  if (tabId == null) return;

  // 1. Acquire streamId in user gesture if volume > 100%
  let streamId = currentStreamId;
  if (v > 100 && !streamId) {
    streamId = await requestStreamId(tabId);
    if (streamId) currentStreamId = streamId;
  } else if (v === 100 && final) {
    currentStreamId = null;
  }

  // 2. Control tabCapture in background service worker
  const r = await api.runtime.sendMessage({ type: 'setVolume', tabId, vol: v, final, streamId }).catch(() => null);
  const isCaptured = !!(r && r.ok && r.active);

  // 3. Apply in-page media volume: native volume for <= 100%, and in-page fallback filters if not captured
  const res = await exec(pageApplyVolume, [v, isCaptured]);
  const hasPageMedia = res && res.some((x) => x && x.result > 0);

  if (!r || !r.ok) {
    if (v > 100 && !hasPageMedia) {
      note(volErrorNote, t('captureError'), true);
    } else {
      note(volErrorNote, '', false);
    }
  } else {
    note(volErrorNote, '', false);
  }
});

const setVol = (v, final) => {
  if (v > 0) lastNonZeroVol = v;
  showVol(v);
  sendVol({ v, final });
};

vol.addEventListener('input', () => setVol(+vol.value, false));
vol.addEventListener('change', () => setVol(+vol.value, true));
$('volChips').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && b.dataset.v != null) setVol(+b.dataset.v, true);
});

if (muteBtn) {
  muteBtn.addEventListener('click', () => {
    const current = +vol.value;
    if (current > 0) {
      lastNonZeroVol = current;
      setVol(0, true);
    } else {
      setVol(lastNonZeroVol || 100, true);
    }
  });
}

if (volOut && volInput) {
  volOut.addEventListener('click', () => {
    volOut.style.display = 'none';
    volInput.style.display = 'inline-block';
    volInput.value = vol.value;
    volInput.focus();
    volInput.select();
  });

  function commitVolInput() {
    let val = parseInt(volInput.value, 10);
    if (isNaN(val)) val = +vol.value;
    val = Math.min(500, Math.max(0, val));
    volInput.style.display = 'none';
    volOut.style.display = 'inline-block';
    setVol(val, true);
  }

  volInput.addEventListener('blur', commitVolInput);
  volInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitVolInput();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      volInput.style.display = 'none';
      volOut.style.display = 'inline-block';
      showVol(+vol.value);
    }
  });
}

/* ---------- Video Speed Controls ---------- */
function showSpd(p) {
  spd.value = p;
  paint(spd);
  $('spdOut').textContent = num.format(p / 100) + '×';
  spd.setAttribute('aria-valuetext', num.format(p / 100) + '×');
  mark($('spdChips'), p);
}

const sendSpdImmediate = coalesce(async (p) => {
  try {
    const res = await exec(pageApplyRate, [p / 100]);
    const n = res.reduce((a, x) => a + (x.result || 0), 0);
    note($('spdNote'), n ? '' : t('noMedia'));
  } catch (_) {
    note($('spdNote'), t('speedError'), true);
  }
});

const sendSpdThrottled = throttle(sendSpdImmediate, 30);

const setSpd = (p, immediate = false) => {
  p = Math.min(500, Math.max(25, Math.round(p / 5) * 5));
  showSpd(p);
  if (immediate) sendSpdImmediate(p);
  else sendSpdThrottled(p);
};

spd.addEventListener('input', () => setSpd(+spd.value, false));
spd.addEventListener('change', () => setSpd(+spd.value, true));
$('spdChips').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && b.dataset.v != null) setSpd(+b.dataset.v, true);
});

/* ---------- Initialization ---------- */
(async () => {
  showVol(100);
  showSpd(100);

  const tab = await tabReadyPromise;
  if (!tab || tab.id == null) return;

  if (RESTRICTED.test(tab.url || '')) {
    $('restricted').hidden = false;
    $('main').classList.add('off');
    return;
  }

  // Load tab volume from background state
  const s = await api.runtime.sendMessage({ type: 'get', tabId: tab.id }).catch(() => null);
  if (s && s.ok && typeof s.vol === 'number') {
    showVol(s.vol);
  }

  // Probe media on the page to reflect current playback rate
  try {
    const res = (await exec(pageProbe)).map((x) => x.result).filter((r) => r && r.n);
    const best = res.find((r) => r.playing) || res[0];
    if (best && typeof best.rate === 'number') {
      showSpd(Math.min(500, Math.max(25, Math.round(best.rate * 20) * 5)));
    }
  } catch (_) {}
})();
