function __cvScan(d){const l=[];if(!d)return l;try{const m=d.querySelectorAll("video, audio");for(let i=0;i<m.length;i++)l.push(m[i]);const f=d.querySelectorAll("iframe");for(let j=0;j<f.length;j++){try{if(f[j].contentDocument)l.push(...__cvScan(f[j].contentDocument));}catch(_){}}}catch(_){}return l;} 'use strict';
// Cross-browser API shim
const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

// C.V. — service worker: per-tab volume via tabCapture + offscreen Web Audio.
const OFF_URL = api.runtime.getURL('offscreen.html');
const key = (id) => 't' + id;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const queues = new Map();
let creating = null;

function serial(tabId, fn) {
  const p = (queues.get(tabId) || Promise.resolve()).catch(() => {}).then(fn);
  queues.set(tabId, p);
  const clean = () => { if (queues.get(tabId) === p) queues.delete(tabId); };
  p.then(clean, clean);
  return p;
}

async function hasOffscreen() {
  try {
    const c = await api.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [OFF_URL] });
    return c.length > 0;
  } catch (_) { return false; }
}

const toOff = (msg) => api.runtime.sendMessage({ target: 'offscreen', ...msg });

async function pingOffscreen() {
  for (let i = 0; i < 20; i++) {
    const r = await toOff({ type: 'isActive', tabId: 0 }).catch(() => null);
    if (r) return true;
    await new Promise((res) => setTimeout(res, 40));
  }
  return false;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creating ||= (async () => {
    await api.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Apply the user-selected volume gain to the audio of the current tab.'
    });
    await pingOffscreen();
  })().finally(() => { creating = null; });
  await creating;
}

async function stopCapture(tabId) {
  if (!(await hasOffscreen())) return;
  const r = await toOff({ type: 'stop', tabId }).catch(() => null);
  if (r && r.remaining === 0) await api.offscreen.closeDocument().catch(() => {});
}

function badge(tabId, vol) {
  const text = vol === 100 ? '' : String(vol);
  api.action.setBadgeText({ tabId, text }).catch(() => {});
  if (text) api.action.setBadgeBackgroundColor({ tabId, color: vol > 100 ? '#E5484D' : '#7c5cbf' }).catch(() => {});
}

async function getState(tabId) {
  const k = key(tabId);
  const data = (await api.storage.session.get(k))[k];
  const vol = data && data.vol != null ? data.vol : 100;
  if (vol > 100) {
    if (await hasOffscreen()) {
      const r = await toOff({ type: 'isActive', tabId }).catch(() => null);
      if (!r || !r.active) {
        await forget(tabId);
        return { vol: 100 };
      }
    } else {
      await forget(tabId);
      return { vol: 100 };
    }
  }
  return { vol };
}

const saveState = (tabId, s) => api.storage.session.set({ [key(tabId)]: s });

function getStreamId(tabId) {
  return new Promise((resolve) => {
    try {
      if (api.tabCapture && api.tabCapture.getMediaStreamId) {
        api.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
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

async function setVolume(tabId, vol, final, providedStreamId) {
  vol = clamp(Math.round(Number(vol) || 0), 0, 500);
  if (vol <= 100) {
    await stopCapture(tabId);
    await saveState(tabId, { vol });
    badge(tabId, vol);
    return { vol, active: false };
  } else {
    await ensureOffscreen();
    const r = await toOff({ type: 'gain', tabId, gain: vol / 100 });
    if (!r || !r.ok) {
      let streamId = providedStreamId;
      if (!streamId) {
        streamId = await getStreamId(tabId);
      }
      if (!streamId) {
        try {
          streamId = await api.tabCapture.getMediaStreamId({ targetTabId: tabId });
        } catch (_) {}
      }
      if (!streamId) throw new Error('Cannot obtain mediaStreamId');
      const s = await toOff({ type: 'start', tabId, streamId, gain: vol / 100 });
      if (!s || !s.ok) throw new Error((s && s.error) || 'capture failed');
    }
  }
  await saveState(tabId, { vol });
  badge(tabId, vol);
  return { vol, active: true };
}

async function forget(tabId) {
  await api.storage.session.remove(key(tabId)).catch(() => {});
  badge(tabId, 100);
}

/* ---------- Update checker (GitHub Releases - Max once per 24 hours) ---------- */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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

async function evaluateRelease(release) {
  if (!release) return;
  const latestTag = (release.tag_name || release.name || '').replace(/^v/i, '').trim();
  const currentVer = api.runtime.getManifest().version;
  if (latestTag && isNewerVersion(latestTag, currentVer)) {
    await api.storage.local.set({
      updateAvailable: latestTag,
      updateUrl: release.html_url || 'https://github.com/d4ruerk1/ChromeStore-C.V/releases/latest'
    });
  } else {
    await api.storage.local.remove(['updateAvailable', 'updateUrl']);
  }
}

async function checkGithubUpdate(force = false) {
  try {
    const currentVer = api.runtime.getManifest().version;
    const stored = await api.storage.local.get(['lastUpdateCheck', 'updateAvailable', 'updateUrl']);
    
    // Purge outdated update info if stored version is not newer than current manifest
    if (stored.updateAvailable && !isNewerVersion(stored.updateAvailable, currentVer)) {
      await api.storage.local.remove(['updateAvailable', 'updateUrl']);
    }

    const now = Date.now();
    const lastCheck = stored.lastUpdateCheck || 0;

    // Check at most once every 24 hours unless forced
    if (!force && (now - lastCheck < ONE_DAY_MS)) {
      return;
    }

    await api.storage.local.set({ lastUpdateCheck: now });

    const res = await fetch('https://api.github.com/repos/d4ruerk1/ChromeStore-C.V/releases/latest', {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });

    if (!res.ok) {
      if (res.status === 404) {
        const listRes = await fetch('https://api.github.com/repos/d4ruerk1/ChromeStore-C.V/releases', {
          headers: { 'Accept': 'application/vnd.github.v3+json' }
        });
        if (listRes.ok) {
          const list = await listRes.json();
          if (Array.isArray(list) && list.length > 0) {
            await evaluateRelease(list[0]);
            return;
          }
        }
      }
      return;
    }

    const release = await res.json();
    await evaluateRelease(release);
  } catch (_) {}
}

api.runtime.onMessage.addListener((msg, sender, send) => {
  if (!msg || msg.target === 'offscreen') return;
  if (msg.type === 'ended') { forget(msg.tabId); return; }
  if (msg.type === 'checkUpdate') { checkGithubUpdate(!!msg.force); return; }
  const tabId = msg.tabId;
  if (!Number.isInteger(tabId)) return;
  let job;
  if (msg.type === 'get') job = () => getState(tabId);
  else if (msg.type === 'setVolume') job = () => setVolume(tabId, msg.vol, !!msg.final, msg.streamId);
  else return;
  serial(tabId, job).then(
    (r) => send({ ok: true, ...r }),
    (e) => send({ ok: false, error: String((e && e.message) || e) })
  );
  return true;
});

api.tabs.onRemoved.addListener((tabId) => {
  serial(tabId, async () => {
    await stopCapture(tabId);
    await api.storage.session.remove(key(tabId)).catch(() => {});
  });
});

api.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    api.storage.local.get({ rememberVol: true }).then(async (data) => {
      if (!data.rememberVol) {
        serial(tabId, async () => {
          await stopCapture(tabId);
          await forget(tabId);
        });
      }
    }).catch(() => {});
  }
});

/* ---------- In-page media volume & speed injection helpers ---------- */
function injectMediaVolume(tabId, v) {
  const norm = Math.max(0, Math.min(1, v / 100));
  const isCaptured = v > 100;
  const code = (volVal, normVal, isCap) => {
    function findAllMedia(root) {
    let list = [];
    if (!root) return list;
    try {
      const media = root.querySelectorAll('video, audio');
      for (let i = 0; i < media.length; i++) list.push(media[i]);
    } catch (_) {}
    try {
      const frames = root.querySelectorAll('iframe, frame');
      for (let i = 0; i < frames.length; i++) {
        try {
          const doc = frames[i].contentDocument || frames[i].contentWindow?.document;
          if (doc) list = list.concat(findAllMedia(doc));
        } catch (_) {}
      }
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
        media[i].volume = normVal;
        media[i].muted = (volVal === 0);
      } catch (_) {}
    }
    try {
      const yt = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (yt) {
        if (volVal === 0 && typeof yt.mute === 'function') yt.mute();
        else if (typeof yt.unMute === 'function') yt.unMute();
        if (typeof yt.setVolume === 'function') yt.setVolume(Math.min(100, volVal));
      }
    } catch (_) {}

    // Audio handling: neutral when <= 100% or captured, transparent limiter if uncaptured boost
    if (volVal <= 100 || isCap) {
      try {
        if (window.__cvAudioCtx) {
          for (let i = 0; i < media.length; i++) {
            if (media[i].__cvGain) {
              media[i].__cvGain.gain.setValueAtTime(1.0, window.__cvAudioCtx.currentTime);
            }
          }
        }
      } catch (_) {}
    } else if (!isCap && volVal > 100) {
      const boost = volVal / 100;
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
                el.__cvGain = ctx.createGain();

                // Clean transparent dynamics limiter
                el.__cvLimiter = ctx.createDynamicsCompressor();
                el.__cvLimiter.threshold.value = -2.0;
                el.__cvLimiter.knee.value = 12;
                el.__cvLimiter.ratio.value = 20;
                el.__cvLimiter.attack.value = 0.002;
                el.__cvLimiter.release.value = 0.06;

                el.__cvSource.connect(el.__cvGain);
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
    }

    window.__cvTargetVol = volVal;
    window.__cvIsCaptured = isCap;
  };

  api.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: code,
    args: [v, norm, isCaptured]
  }).catch(() => {
    api.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: code,
      args: [v, norm, isCaptured]
    }).catch(() => {});
  });
}

function injectSpeedAdjustment(tabId, delta, exactRate) {
  const code = (delta, exactRate) => {
    let next;
    if (typeof exactRate === 'number') {
      next = exactRate;
    } else {
      let cur = window.__cvRate;
      if (typeof cur !== 'number') {
        const v = document.querySelector('video, audio');
        cur = v ? v.playbackRate : 1.0;
      }
      next = Math.min(5.0, Math.max(0.25, Math.round((cur + delta) * 4) / 4));
    }
    window.__cvRate = next;

    if (!window.__cvProtoPatched) {
      window.__cvProtoPatched = true;
      try {
        const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
        if (desc && desc.set) {
          window.__cvOrigRateSet = desc.set;
          window.__cvOrigRateGet = desc.get;
          Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
            configurable: true,
            enumerable: true,
            get() {
              return window.__cvOrigRateGet.call(this);
            },
            set(val) {
              if (this.__cvSetting) return window.__cvOrigRateSet.call(this, val);
              const tr = window.__cvRate;
              if (typeof tr === 'number' && Math.abs(val - tr) > 0.01) {
                return;
              }
              return window.__cvOrigRateSet.call(this, val);
            }
          });
        }
      } catch (_) {}

      try {
        if (!window.__cvPitchPatched) {
          window.__cvPitchPatched = true;
          Object.defineProperty(HTMLMediaElement.prototype, 'preservesPitch', {
            configurable: true,
            enumerable: true,
            get() { return true; },
            set(_) {}
          });
        }
      } catch (_) {}
    }

    function applySpeed(el, val) {
      try {
        el.__cvSetting = true;
        el.preservesPitch = true;
        if ('mozPreservesPitch' in el) el.mozPreservesPitch = true;
        if ('webkitPreservesPitch' in el) el.webkitPreservesPitch = true;
        if (window.__cvOrigRateSet) {
          window.__cvOrigRateSet.call(el, val);
        } else {
          el.playbackRate = val;
        }
        el.defaultPlaybackRate = val;
      } catch (_) {} finally {
        el.__cvSetting = false;
      }
    }

    function findAllMedia(root) {
      let list = [];
      if (!root) return list;
      try {
        const media = root.querySelectorAll('video, audio');
        for (let i = 0; i < media.length; i++) list.push(media[i]);
      } catch (_) {}
      try {
        const frames = root.querySelectorAll('iframe, frame');
        for (let i = 0; i < frames.length; i++) {
          try {
            const doc = frames[i].contentDocument || frames[i].contentWindow?.document;
            if (doc) list = list.concat(findAllMedia(doc));
          } catch (_) {}
        }
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
      applySpeed(media[i], next);
      if (!media[i].__cvRateHooked) {
        media[i].__cvRateHooked = true;
        let timer = null;
        media[i].addEventListener('ratechange', (e) => {
          if (media[i].__cvSetting) return;
          const tr = window.__cvRate;
          if (typeof tr === 'number' && Math.abs(media[i].playbackRate - tr) > 0.01) {
            if (!location.hostname.includes('youtube.com')) {
              e.stopImmediatePropagation();
            }
            if (!timer) {
              timer = setTimeout(() => {
                timer = null;
                applySpeed(media[i], window.__cvRate);
              }, 300);
            }
          }
        }, true);
      }
    }

    try {
      const yt = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (yt && typeof yt.setPlaybackRate === 'function') {
        if (next <= 2.0) {
          if (typeof yt.getPlaybackRate === 'function') {
            if (Math.abs(yt.getPlaybackRate() - next) > 0.01) yt.setPlaybackRate(next);
          } else {
            yt.setPlaybackRate(next);
          }
        }
      }
    } catch (_) {}
  };

  api.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: code,
    args: [delta, exactRate]
  }).catch(() => {
    api.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: code,
      args: [delta, exactRate]
    }).catch(() => {});
  });
}

/* ---------- Window focus & tab management for robust Auto-PiP ---------- */
let lastFocusedWindowId = null;
let blurDebounceTimer = null;
const lastActiveTabByWindow = new Map();

if (api.windows && api.windows.onFocusChanged) {
  api.windows.getLastFocused({ populate: false }).then((win) => {
    if (win && win.id != null) lastFocusedWindowId = win.id;
  }).catch(() => {});

  api.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === api.windows.WINDOW_ID_NONE) {
      // Debounce WINDOW_ID_NONE (200ms) to ignore transient focus loss during PiP close or window transitions
      if (blurDebounceTimer) clearTimeout(blurDebounceTimer);
      blurDebounceTimer = setTimeout(async () => {
        blurDebounceTimer = null;
        try {
          let tabs = [];
          if (lastFocusedWindowId != null) {
            tabs = await api.tabs.query({ active: true, windowId: lastFocusedWindowId }).catch(() => []);
          }
          if (!tabs || tabs.length === 0) {
            tabs = await api.tabs.query({ active: true }).catch(() => []);
          }
          if (tabs && tabs.length > 0) {
            for (const tab of tabs) {
              if (tab.id != null) {
                api.tabs.sendMessage(tab.id, { type: 'cv-window-blur' }).catch(() => {});
              }
            }
          }
        } catch (_) {}
      }, 200);
    } else {
      // A Brave window is focused: cancel any pending blur
      if (blurDebounceTimer) {
        clearTimeout(blurDebounceTimer);
        blurDebounceTimer = null;
      }

      const prevWinId = lastFocusedWindowId;
      lastFocusedWindowId = windowId;

      // If focus changed from one Brave window to another:
      if (prevWinId != null && prevWinId !== windowId) {
        api.tabs.query({ active: true, windowId: prevWinId }).then((oldTabs) => {
          if (oldTabs && oldTabs.length > 0) {
            for (const tab of oldTabs) {
              if (tab.id != null) {
                api.tabs.sendMessage(tab.id, { type: 'cv-window-blur' }).catch(() => {});
              }
            }
          }
        }).catch(() => {});
      }

      // Notify the active tab of the newly focused window that it regained focus
      api.tabs.query({ active: true, windowId }).then((newTabs) => {
        if (newTabs && newTabs.length > 0) {
          for (const tab of newTabs) {
            if (tab.id != null) {
              api.tabs.sendMessage(tab.id, { type: 'cv-window-focus' }).catch(() => {});
            }
          }
        }
      }).catch(() => {});
    }
  });

  if (api.windows.onRemoved) {
    api.windows.onRemoved.addListener((windowId) => {
      if (lastFocusedWindowId === windowId) {
        lastFocusedWindowId = null;
      }
      lastActiveTabByWindow.delete(windowId);
    });
  }
}

if (api.tabs && api.tabs.onActivated) {
  api.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      if (activeInfo && activeInfo.windowId != null) {
        lastFocusedWindowId = activeInfo.windowId;
      }
      const prevTabId = lastActiveTabByWindow.get(activeInfo.windowId);
      lastActiveTabByWindow.set(activeInfo.windowId, activeInfo.tabId);
      if (prevTabId != null && prevTabId !== activeInfo.tabId) {
        api.tabs.sendMessage(prevTabId, { type: 'cv-tab-deactivated' }).catch(() => {});
      }
      api.tabs.sendMessage(activeInfo.tabId, { type: 'cv-tab-activated' }).catch(() => {});
    } catch (_) {}
  });
}

// Keyboard shortcuts support
if (api.commands && api.commands.onCommand) {
  api.commands.onCommand.addListener(async (command) => {
    try {
      let tabs = await api.tabs.query({ active: true, currentWindow: true }).catch(() => []);
      if (!tabs || !tabs.length) tabs = await api.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
      if (!tabs || !tabs.length) tabs = await api.tabs.query({ active: true }).catch(() => []);
      const tab = tabs.find((t) => t.id != null && (!t.url || !t.url.startsWith('chrome-extension://'))) || tabs[0];
      if (!tab || tab.id == null) return;
      const tabId = tab.id;

      if (command === 'volume-boost-down' || command === 'volume-down') {
        const s = await getState(tabId);
        const cur = s.vol != null ? s.vol : 100;
        // Always decrement in exact steps of 5%
        const nextVol = Math.max(0, Math.round((cur - 5) / 5) * 5);
        await setVolume(tabId, nextVol, true);
        injectMediaVolume(tabId, nextVol);
      } else if (command === 'volume-boost-reset' || command === 'volume-reset') {
        await setVolume(tabId, 100, true);
        injectMediaVolume(tabId, 100);
      } else if (command === 'volume-boost-up' || command === 'volume-up') {
        const s = await getState(tabId);
        const cur = s.vol != null ? s.vol : 100;
        // Always increment in exact steps of 5%
        const nextVol = Math.min(500, Math.round((cur + 5) / 5) * 5);
        await setVolume(tabId, nextVol, true);
        injectMediaVolume(tabId, nextVol);
      } else if (command === 'speed-up') {
        await injectSpeedAdjustment(tabId, 0.25, null);
      } else if (command === 'speed-down') {
        await injectSpeedAdjustment(tabId, -0.25, null);
      } else if (command === 'speed-reset') {
        await injectSpeedAdjustment(tabId, null, 1.0);
      } else if (command === 'toggle-pip') {
        try {
          const res = await api.tabs.sendMessage(tabId, { type: 'toggle-pip' }).catch(() => null);
          if (!res || res.result === 'none') {
            await api.scripting.executeScript({
              target: { tabId, allFrames: true },
              func: () => {
                if (window.__cvPip) return window.__cvPip.toggle();
              }
            }).catch(() => {});
          }
        } catch (_) {}
      }
    } catch (_) {}
  });
}

// Check for updates on startup (at most once every 24 hours)
api.runtime.onStartup.addListener(() => {
  checkGithubUpdate(false);
});

api.runtime.onInstalled.addListener(async () => {
  checkGithubUpdate(false);
  try {
    const s = await api.storage.sync.get({ autoPip: true });
    await api.storage.sync.set(s);
  } catch (_) {}
  try {
    const l = await api.storage.local.get({ rememberVol: true, autoPip: true });
    await api.storage.local.set(l);
  } catch (_) {}
});
