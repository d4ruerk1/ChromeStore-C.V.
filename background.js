'use strict';
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

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creating ||= api.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Apply the user-selected volume gain to the audio of the current tab.'
  }).finally(() => { creating = null; });
  await creating;
}

const toOff = (msg) => api.runtime.sendMessage({ target: 'offscreen', ...msg });

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
  if (vol !== 100) {
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

async function setVolume(tabId, vol, final) {
  vol = clamp(Math.round(Number(vol) || 0), 0, 500);
  if (vol === 100 && final) {
    await stopCapture(tabId);
  } else {
    await ensureOffscreen();
    const r = await toOff({ type: 'gain', tabId, gain: vol / 100 });
    if (!r || !r.ok) {
      if (vol === 100) { await saveState(tabId, { vol }); badge(tabId, vol); return { vol }; }
      const streamId = await api.tabCapture.getMediaStreamId({ targetTabId: tabId });
      const s = await toOff({ type: 'start', tabId, streamId, gain: vol / 100 });
      if (!s || !s.ok) throw new Error((s && s.error) || 'capture failed');
    }
  }
  await saveState(tabId, { vol });
  badge(tabId, vol);
  return { vol };
}

async function forget(tabId) {
  await api.storage.session.remove(key(tabId)).catch(() => {});
  badge(tabId, 100);
}

/* ---------- Update checker (GitHub Releases) ---------- */
function isNewerVersion(remote, local) {
  const r = String(remote || '').replace(/^v/, '').split('.').map(Number);
  const l = String(local || '').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] || 0, lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

async function checkGithubUpdate() {
  try {
    const data = await api.storage.local.get({ notifyUpdates: true });
    if (!data.notifyUpdates) return;
    const res = await fetch('https://api.github.com/repos/d4ruerk1/ChromeStore-C.V/releases/latest', {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!res.ok) return;
    const release = await res.json();
    const latestTag = (release.tag_name || release.name || '').replace(/^v/, '');
    const currentVer = api.runtime.getManifest().version;
    if (latestTag && isNewerVersion(latestTag, currentVer)) {
      await api.storage.local.set({
        updateAvailable: latestTag,
        updateUrl: release.html_url || 'https://github.com/d4ruerk1/ChromeStore-C.V'
      });
    } else {
      await api.storage.local.remove(['updateAvailable', 'updateUrl']);
    }
  } catch (_) {}
}

api.runtime.onMessage.addListener((msg, sender, send) => {
  if (!msg || msg.target === 'offscreen') return;
  if (msg.type === 'ended') { forget(msg.tabId); return; }
  if (msg.type === 'checkUpdateNow') { checkGithubUpdate(); return; }
  const tabId = msg.tabId;
  if (!Number.isInteger(tabId)) return;
  let job;
  if (msg.type === 'get') job = () => getState(tabId);
  else if (msg.type === 'setVolume') job = () => setVolume(tabId, msg.vol, !!msg.final);
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

// Periodic update check on startup
api.runtime.onStartup.addListener(() => {
  checkGithubUpdate();
});
