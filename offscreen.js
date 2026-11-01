'use strict';
const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const tabs = new Map();
let ctx = null;
let clipperCurve = null;

// Precompute smooth soft-clipping curve (100% linear up to 0.75, smooth tanh saturation up to 1.0)
function getClipperCurve() {
  if (clipperCurve) return clipperCurve;
  const n = 4096;
  const curve = new Float32Array(n);
  const threshold = 0.75;
  const headroom = 1.0 - threshold;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1; // [-1, 1]
    const ax = Math.abs(x);
    if (ax <= threshold) {
      curve[i] = x;
    } else {
      const sign = x >= 0 ? 1 : -1;
      curve[i] = sign * (threshold + headroom * Math.tanh((ax - threshold) / headroom));
    }
  }
  clipperCurve = curve;
  return curve;
}

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
    t.gain.disconnect();
    t.lim.disconnect();
    t.clipper.disconnect();
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
  // Allow smooth boost up to 500% (5.0)
  const clampedGain = Math.max(0, Math.min(5, g));
  t.gain.gain.setTargetAtTime(clampedGain, audioCtx.currentTime, 0.015);
}

async function start(tabId, streamId, g) {
  stop(tabId);

  let stream;
  try {
    // Disable APM (echoCancellation, noiseSuppression, autoGainControl)
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
  const gain = audioCtx.createGain();
  gain.gain.value = Math.max(0, Math.min(5, g));

  // Professional Dynamics Compressor tuned for transparent boost without distortion or pumping
  const lim = audioCtx.createDynamicsCompressor();
  lim.threshold.value = -24;
  lim.knee.value = 30;
  lim.ratio.value = 12;
  lim.attack.value = 0.003;
  lim.release.value = 0.25;

  // Soft-clipper to catch transient peaks smoothly with zero harsh clipping
  const clipper = audioCtx.createWaveShaper();
  clipper.curve = getClipperCurve();
  clipper.oversample = 'none';

  src.connect(gain).connect(lim).connect(clipper).connect(audioCtx.destination);
  tabs.set(tabId, { stream, src, gain, lim, clipper });

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
