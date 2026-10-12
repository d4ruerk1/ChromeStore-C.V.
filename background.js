'use strict';
// C.V. — service worker: per-tab volume via tabCapture + offscreen Web Audio.
const OFF_URL = chrome.runtime.getURL('offscreen.html');
const key = (id) => 't' + id;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const queues = new Map();
let creating = null;

// Serialize operations per tab to avoid capture races while dragging the slider.
function serial(tabId, fn) {
  const p = (queues.get(tabId) || Promise.resolve()).catch(() => {}).then(fn);
  queues.set(tabId, p);
  const clean = () => { if (queues.get(tabId) === p) queues.delete(tabId); };
  p.then(clean, clean);
  return p;
}

async function getState(tabId) {
  const k = key(tabId);
  return { vol: 100, ...(await chrome.storage.session.get(k))[k] };
}
const saveState = (tabId, s) => chrome.storage.session.set({ [key(tabId)]: s });

async function hasOffscreen() {
  const c = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [OFF_URL] });
  return c.length > 0;
}
async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creating ||= chrome.offscreen.createDocument({
    url: 'offscreen.html', reasons: ['USER_MEDIA'],
    justification: 'Apply the user-selected volume gain to the audio of the current tab.'
  }).finally(() => { creating = null; });
  await creating;
}
const toOff = (msg) => chrome.runtime.sendMessage({ target: 'offscreen', ...msg });

async function stopCapture(tabId) {
  if (!(await hasOffscreen())) return;
  const r = await toOff({ type: 'stop', tabId }).catch(() => null);
  if (r && r.remaining === 0) await chrome.offscreen.closeDocument().catch(() => {});
}

function badge(tabId, vol) {
  const text = vol === 100 ? '' : String(vol);
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (text) chrome.action.setBadgeBackgroundColor({ tabId, color: vol > 100 ? '#E5484D' : '#6E56CF' }).catch(() => {});
}

async function setVolume(tabId, vol, final) {
  vol = clamp(Math.round(Number(vol) || 0), 0, 300);
  if (vol === 100 && final) {
    await stopCapture(tabId); // free resources + remove capture indicator
  } else {
    await ensureOffscreen();
    const r = await toOff({ type: 'gain', tabId, gain: vol / 100 });
    if (!r || !r.ok) {
      if (vol === 100) { await saveState(tabId, { vol }); badge(tabId, vol); return { vol }; }
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
      const s = await toOff({ type: 'start', tabId, streamId, gain: vol / 100 });
      if (!s || !s.ok) throw new Error((s && s.error) || 'capture failed');
    }
  }
  await saveState(tabId, { vol });
  badge(tabId, vol);
  return { vol };
}

async function forget(tabId) {
  await chrome.storage.session.remove(key(tabId));
  badge(tabId, 100);
}

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (!msg || msg.target === 'offscreen') return;
  if (msg.type === 'ended') { forget(msg.tabId); return; }
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

chrome.tabs.onRemoved.addListener((tabId) => {
  serial(tabId, async () => { await stopCapture(tabId); await chrome.storage.session.remove(key(tabId)); });
});
