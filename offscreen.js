'use strict';
const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const tabs = new Map();
let ctx = null;

function getContext() {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'playback' });
  }
  return ctx;
}

function stop(tabId) {
  const t = tabs.get(tabId);
  if (!t) return;
  tabs.delete(tabId);
  try {
    t.src.disconnect();
    if (t.hp) t.hp.disconnect();
    if (t.gain) t.gain.disconnect();
    if (t.lim) t.lim.disconnect();
  } catch (_) {}
  try {
    t.stream.getTracks().forEach((tr) => tr.stop());
  } catch (_) {}
  if (!tabs.size && ctx) {
    ctx.close().catch(() => {});
    ctx = null;
  }
}

function setGain(t, g) {
  const audioCtx = getContext();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  // Allow clean boost up to 500% (5.0)
  const clampedGain = Math.max(1.0, Math.min(5.0, g));
  t.gain.gain.setTargetAtTime(clampedGain, audioCtx.currentTime, 0.015);
}

async function start(tabId, streamId, g) {
  stop(tabId);

  let stream;
  try {
    // Disable Chromium APM (echoCancellation, noiseSuppression, autoGainControl)
    // so Chromium does not alter tab audio or burn CPU
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        },
        optional: [
          { echoCancellation: false },
          { noiseSuppression: false },
          { autoGainControl: false },
          { googEchoCancellation: false },
          { googAutoGainControl: false },
          { googNoiseSuppression: false },
          { googHighpassFilter: false },
          { googTypingNoiseDetection: false }
        ]
      },
      video: false
    });
  } catch (_) {
    // Fallback in case of browser-specific constraint parsing
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });
  }

  const audioCtx = getContext();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  const src = audioCtx.createMediaStreamSource(stream);

  // 1. High-Pass Filter: Cuts inaudible sub-bass below 30 Hz to eliminate DC offset and sub-rumble without thinning audio
  const hp = audioCtx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 30;
  hp.Q.value = 0.5;

  // 2. Gain Node (volume multiplier from 1.0 to 5.0)
  const gain = audioCtx.createGain();
  gain.gain.value = Math.max(1.0, Math.min(5.0, g));

  // 3. Transparent Brickwall Limiter:
  // Catches boosted signal peaks transparently without harsh saturation distortion or muffled transients
  const lim = audioCtx.createDynamicsCompressor();
  lim.threshold.value = -2.0;
  lim.knee.value = 12;
  lim.ratio.value = 20;
  lim.attack.value = 0.002;
  lim.release.value = 0.06;

  src.connect(hp);
  hp.connect(gain);
  gain.connect(lim);
  lim.connect(audioCtx.destination);

  tabs.set(tabId, { stream, src, hp, gain, lim });

  const track = stream.getAudioTracks()[0];
  if (track) {
    track.addEventListener('ended', () => {
      stop(tabId);
      api.runtime.sendMessage({ type: 'ended', tabId }).catch(() => {});
    });
  }
}

async function handle(m) {
  if (m.type === 'gain') {
    const t = tabs.get(m.tabId);
    if (!t) return { ok: false };
    setGain(t, m.gain);
    return { ok: true };
  }
  if (m.type === 'start') {
    await start(m.tabId, m.streamId, m.gain);
    return { ok: true };
  }
  if (m.type === 'stop') {
    stop(m.tabId);
    return { ok: true, remaining: tabs.size };
  }
  if (m.type === 'isActive') {
    return { ok: true, active: tabs.has(m.tabId) };
  }
  return { ok: false };
}

api.runtime.onMessage.addListener((m, _s, send) => {
  if (!m || m.target !== 'offscreen') return;
  handle(m).then(send, (e) => send({ ok: false, error: String((e && e.message) || e) }));
  return true;
});
