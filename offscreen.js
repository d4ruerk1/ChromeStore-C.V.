'use strict';
// C.V. — offscreen audio engine: tab stream -> gain -> soft limiter -> speakers.
const tabs = new Map();
let ctx = null;

function stop(tabId) {
  const t = tabs.get(tabId);
  if (!t) return;
  tabs.delete(tabId);
  try { t.src.disconnect(); t.gain.disconnect(); t.lim.disconnect(); } catch (_) {}
  t.stream.getTracks().forEach((tr) => tr.stop());
  if (!tabs.size && ctx) { ctx.close().catch(() => {}); ctx = null; }
}

function setGain(t, g) {
  t.gain.gain.setTargetAtTime(Math.max(0, Math.min(3, g)), ctx.currentTime, 0.015);
}

async function start(tabId, streamId, g) {
  stop(tabId);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }, video: false
  });
  ctx ||= new AudioContext({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const gain = ctx.createGain();
  gain.gain.value = g;
  const lim = ctx.createDynamicsCompressor(); // prevents harsh clipping when boosting
  lim.threshold.value = -0.5; lim.knee.value = 0; lim.ratio.value = 20;
  lim.attack.value = 0.002; lim.release.value = 0.2;
  src.connect(gain).connect(lim).connect(ctx.destination);
  tabs.set(tabId, { stream, src, gain, lim });
  const track = stream.getAudioTracks()[0];
  if (track) track.addEventListener('ended', () => {
    stop(tabId);
    chrome.runtime.sendMessage({ type: 'ended', tabId }).catch(() => {});
  });
}

async function handle(m) {
  if (m.type === 'gain') {
    const t = tabs.get(m.tabId);
    if (!t) return { ok: false };
    setGain(t, m.gain);
    return { ok: true };
  }
  if (m.type === 'start') { await start(m.tabId, m.streamId, m.gain); return { ok: true }; }
  if (m.type === 'stop') { stop(m.tabId); return { ok: true, remaining: tabs.size }; }
  return { ok: false };
}

chrome.runtime.onMessage.addListener((m, _s, send) => {
  if (!m || m.target !== 'offscreen') return;
  handle(m).then(send, (e) => send({ ok: false, error: String((e && e.message) || e) }));
  return true;
});
