'use strict';
/**
 * C.V. - Offscreen Document
 * Audio Processing, Anti-Distortion Boost Engine & High-Speed Speech Clarity DSP
 * Version: 1.3.1
 */
const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const tabs = new Map();
let ctx = null;

function getContext() {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'playback' });
  }
  return ctx;
}

// Pre-computed transparent soft-knee curve: 100% linear up to 0.8 (-2 dBFS), zero harmonic distortion, smooth peak cushion
let softClipCurve = null;
function getSoftClipCurve(samples = 4096) {
  if (softClipCurve && softClipCurve.length === samples) return softClipCurve;
  const curve = new Float32Array(samples);
  const threshold = 0.8;
  const headroom = 1.0 - threshold;
  for (let i = 0; i < samples; ++i) {
    const x = (i * 2) / (samples - 1) - 1; // -1.0 to +1.0
    const absX = Math.abs(x);
    if (absX <= threshold) {
      curve[i] = x;
    } else {
      const sign = x < 0 ? -1 : 1;
      const over = (absX - threshold) / headroom;
      curve[i] = sign * (threshold + headroom * Math.tanh(over));
    }
  }
  softClipCurve = curve;
  return curve;
}

function stop(tabId) {
  const t = tabs.get(tabId);
  if (!t) return;
  tabs.delete(tabId);
  try {
    t.src.disconnect();
    if (t.hp) t.hp.disconnect();
    if (t.leveler) t.leveler.disconnect();
    if (t.mudCut) t.mudCut.disconnect();
    if (t.peak) t.peak.disconnect();
    if (t.shelf) t.shelf.disconnect();
    if (t.gain) t.gain.disconnect();
    if (t.lim) t.lim.disconnect();
    if (t.clipper) t.clipper.disconnect();
  } catch (_) {}
  try {
    t.stream.getTracks().forEach((tr) => tr.stop());
  } catch (_) {}
  if (!tabs.size && ctx) {
    ctx.close().catch(() => {});
    ctx = null;
  }
}

function updateDSP(t, speed, volGain) {
  const audioCtx = getContext();
  const tm = audioCtx.currentTime;
  const spd = typeof speed === 'number' && speed > 0 ? speed : (t.speed || 1.0);
  t.speed = spd;

  const r = Math.min(1.0, Math.max(0, (spd - 1.0) / 4.0)); // 0 at 1x, 1 at 5x
  const isAccelerated = spd > 1.15;

  // 1. Dynamic High-Pass Filter: 40Hz at 1x up to 140Hz at 5x (removes mud and low-frequency rumble that triggers clipping)
  const hpFreq = isAccelerated ? 40 + r * 100 : 40;
  if (t.hp) {
    t.hp.frequency.setTargetAtTime(hpFreq, tm, 0.02);
  }

  // 2. Mud Notch Filter (380 Hz): gently attenuates boxy mid-range resonance of time-stretched audio
  const mudGain = isAccelerated ? -r * 2.5 : 0;
  if (t.mudCut) {
    t.mudCut.gain.setTargetAtTime(mudGain, tm, 0.02);
  }

  // 3. Vocal Presence Peaking Filter (2600 Hz): natural speech consonant enhancement (+1dB to +3.5dB)
  const peakGain = isAccelerated ? 1.0 + r * 2.5 : 0;
  if (t.peak) {
    t.peak.gain.setTargetAtTime(peakGain, tm, 0.02);
  }

  // 4. High-Shelf Brilliance Filter (6000 Hz): air and transient clarity without harshness
  const shelfGain = isAccelerated ? r * 2.0 : 0;
  if (t.shelf) {
    t.shelf.gain.setTargetAtTime(shelfGain, tm, 0.02);
  }

  // 5. Adaptive Limiter & Leveler Timing
  const relTime = isAccelerated ? Math.max(0.015, 0.05 / Math.sqrt(spd)) : 0.05;
  if (t.lim) {
    t.lim.release.setTargetAtTime(relTime, tm, 0.02);
  }
  if (t.leveler) {
    const levRel = isAccelerated ? Math.max(0.04, 0.10 / Math.sqrt(spd)) : 0.08;
    t.leveler.release.setTargetAtTime(levRel, tm, 0.02);
  }

  // 6. Perceptual Volume Gain: scales loudness smoothly and prevents square-wave clipping
  if (typeof volGain === 'number' && t.gain) {
    const rawVal = Math.max(1.0, Math.min(5.0, volGain));
    // Log-perceptual boost: 1.0 (100%) to 3.8 (500%), combining with leveler for massive distortion-free loudness
    const norm = (rawVal - 1.0) / 4.0;
    const effectiveGain = 1.0 + norm * 2.8;
    t.gain.gain.setTargetAtTime(effectiveGain, tm, 0.015);
  }
}

function setGain(t, g) {
  const audioCtx = getContext();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  updateDSP(t, t.speed, g);
}

function setSpeed(t, speed) {
  updateDSP(t, speed);
}

async function start(tabId, streamId, g, speed = 1.0) {
  stop(tabId);

  let stream;
  try {
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

  // 1. Dynamic High-Pass Filter (De-Mudding)
  const hp = audioCtx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 40;
  hp.Q.value = 0.707;

  // 2. Pre-Compressor / Leveler: controls dynamic range before boost, bringing up quiet speech
  const leveler = audioCtx.createDynamicsCompressor();
  leveler.threshold.value = -16.0;
  leveler.knee.value = 10;
  leveler.ratio.value = 4;
  leveler.attack.value = 0.005;
  leveler.release.value = 0.08;

  // 3. Mud Notch Filter (380 Hz): removes hollow boxiness
  const mudCut = audioCtx.createBiquadFilter();
  mudCut.type = 'peaking';
  mudCut.frequency.value = 380;
  mudCut.Q.value = 1.5;
  mudCut.gain.value = 0;

  // 4. Vocal Formant Peaking Filter (2600 Hz): crisp consonant clarity
  const peak = audioCtx.createBiquadFilter();
  peak.type = 'peaking';
  peak.frequency.value = 2600;
  peak.Q.value = 1.1;
  peak.gain.value = 0;

  // 5. High-Shelf Brilliance Filter (6000 Hz)
  const shelf = audioCtx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 6000;
  shelf.gain.value = 0;

  // 6. Volume Gain Node (1.0 to 3.8x perceptual boost)
  const gain = audioCtx.createGain();
  const rawG = Math.max(1.0, Math.min(5.0, g));
  gain.gain.value = 1.0 + ((rawG - 1.0) / 4.0) * 2.8;

  // 7. Brickwall Limiter
  const lim = audioCtx.createDynamicsCompressor();
  lim.threshold.value = -1.5;
  lim.knee.value = 3;
  lim.ratio.value = 20;
  lim.attack.value = 0.001; // 1ms fast catch
  lim.release.value = 0.05;

  // 8. Transparent Soft-Knee Saturation (4x oversampling, 100% linear below 0.8)
  const clipper = audioCtx.createWaveShaper();
  clipper.curve = getSoftClipCurve(4096);
  clipper.oversample = '4x';

  // Connect mastering graph: src -> hp -> leveler -> mudCut -> peak -> shelf -> gain -> lim -> clipper -> destination
  src.connect(hp);
  hp.connect(leveler);
  leveler.connect(mudCut);
  mudCut.connect(peak);
  peak.connect(shelf);
  shelf.connect(gain);
  gain.connect(lim);
  lim.connect(clipper);
  clipper.connect(audioCtx.destination);

  const tabState = { stream, src, hp, leveler, mudCut, peak, shelf, gain, lim, clipper, speed: speed || 1.0 };
  updateDSP(tabState, speed, g);
  tabs.set(tabId, tabState);

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
  if (m.type === 'speed') {
    const t = tabs.get(m.tabId);
    if (t) {
      setSpeed(t, m.speed);
    }
    return { ok: true };
  }
  if (m.type === 'start') {
    await start(m.tabId, m.streamId, m.gain, m.speed);
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
