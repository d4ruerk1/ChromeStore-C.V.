/**
 * C.V. - Content Script
 * Automatic & Manual Picture-in-Picture Engine
 * Version: 1.3.0
 */
(() => {
  'use strict';
  if (window.__cvPipLoaded) return;
  window.__cvPipLoaded = true;

  const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

  let cfg = { autoPip: true };
  let busy = false;
  let autoPipActive = false;
  let pendingAutoExit = false;
  let exitingPiP = false;
  let justExitedPip = false;
  let isVideoPlaying = false;
  let seekHandlersSet = false;
  let suppressAutoEnterUntil = 0;
  const ms = navigator.mediaSession || null;

  // 1. Sync configuration from storage
  function updateConfig(newVal) {
    if (typeof newVal === 'boolean') {
      cfg.autoPip = newVal;
    }
  }

  try {
    api.storage.sync.get({ autoPip: true }).then((data) => {
      updateConfig(data.autoPip !== false);
    }).catch(() => {
      api.storage.local.get({ autoPip: true }).then((data) => {
        updateConfig(data.autoPip !== false);
      }).catch(() => {});
    });

    api.storage.onChanged.addListener((changes, area) => {
      if (changes.autoPip) {
        updateConfig(changes.autoPip.newValue !== false);
      }
    });
  } catch (_) {}

  // 2. Comprehensive Shadow DOM & DOM video discovery
  function getAllVideos(root = document) {
    const list = [];
    if (!root) return list;

    try {
      const vids = root.querySelectorAll('video');
      for (let i = 0; i < vids.length; i++) list.push(vids[i]);
    } catch (_) {}

    // Deep traverse open and accessible shadow DOMs
    try {
      const walker = document.createTreeWalker(
        root instanceof Document ? (root.body || root.documentElement) : root,
        NodeFilter.SHOW_ELEMENT
      );
      let node = walker.currentNode;
      while (node) {
        if (node.shadowRoot) {
          list.push(...getAllVideos(node.shadowRoot));
        }
        node = walker.nextNode();
      }
    } catch (_) {}

    return list;
  }

  // 3. Candidate evaluation
  function pickCandidate(requirePlaying = false) {
    const videos = getAllVideos(document);
    if (!videos.length) return null;

    let best = null;
    let bestScore = -1;

    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      if (!v || v.ended) continue;

      // Unlock PiP permissions if site attempted to block it, and enable autoPiP
      try {
        if (v.disablePictureInPicture) v.disablePictureInPicture = false;
        if (v.hasAttribute && v.hasAttribute('disablepictureinpicture')) {
          v.removeAttribute('disablepictureinpicture');
        }
        if (!v.autoPictureInPicture) v.autoPictureInPicture = true;
        if (!v.hasAttribute('autopictureinpicture')) {
          v.setAttribute('autopictureinpicture', '');
        }
      } catch (_) {}

      const isPlaying = !v.paused && (v.currentTime > 0 || v.readyState >= 2);
      if (requirePlaying && !isPlaying) continue;

      let area = 0;
      let r = null;
      try {
        r = v.getBoundingClientRect();
        area = Math.max(1, r.width * r.height);
      } catch (_) {
        area = (v.videoWidth || 1) * (v.videoHeight || 1);
      }

      // Ignore microscopic/invisible background ads in auto-mode
      if (requirePlaying) {
        if (r && (r.width < 120 || r.height < 80)) continue;
        if (Number.isFinite(v.duration) && v.duration > 0 && v.duration < 3) continue;
      }

      // Prioritize active playback, audibility, and display size
      let score = area;
      if (isPlaying) score *= 10000;
      if (!v.muted && v.volume > 0) score *= 2;
      if (v.readyState >= 2) score *= 1.5;

      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }

    if (!best && !requirePlaying && videos.length > 0) {
      best = videos[0];
    }
    return best;
  }

  // 4. Request Picture-in-Picture
  async function enterPiP(v, isAuto, force = false) {
    if (!v || busy || exitingPiP) return;
    if (Date.now() < suppressAutoEnterUntil) return;
    // If auto-entering without force, but user is already back on the visible & focused document, don't enter
    if (isAuto && !force && !document.hidden && typeof document.hasFocus === 'function' && document.hasFocus()) {
      return;
    }

    try {
      busy = true;
      pendingAutoExit = false;

      if (v.disablePictureInPicture) v.disablePictureInPicture = false;
      if (v.hasAttribute && v.hasAttribute('disablepictureinpicture')) {
        v.removeAttribute('disablepictureinpicture');
      }
      try {
        if (!v.autoPictureInPicture) v.autoPictureInPicture = true;
        if (!v.hasAttribute('autopictureinpicture')) {
          v.setAttribute('autopictureinpicture', '');
        }
      } catch (_) {}

      isVideoPlaying = !v.paused;
      autoPipActive = isAuto;

      await v.requestPictureInPicture();

      // Race condition check:
      // If during requestPictureInPicture await the user already returned to this tab/window,
      // or autoExit was triggered:
      const docHasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : false;
      if (isAuto && (pendingAutoExit || (!document.hidden && docHasFocus))) {
        pendingAutoExit = false;
        if (document.pictureInPictureElement) {
          exitingPiP = true;
          await document.exitPictureInPicture().catch(() => {});
          exitingPiP = false;
        }
      }
    } catch (_) {
      autoPipActive = false;
    } finally {
      busy = false;
      pendingAutoExit = false;
    }
  }

  // 5. Auto PiP Handlers
  function autoEnter(force = false) {
    if (!cfg.autoPip || busy || exitingPiP || justExitedPip || Date.now() < suppressAutoEnterUntil || document.pictureInPictureElement) return;
    // Allow trigger if document is hidden OR if forced by window blur / external app focus
    if (!force && !document.hidden) return;

    const v = pickCandidate(true);
    if (v) {
      enterPiP(v, true, force).catch(() => {});
    }
  }

  async function autoExit() {
    suppressAutoEnterUntil = Date.now() + 2500;
    if (busy) {
      // enterPiP is currently in-flight; signal it to exit immediately once resolved
      pendingAutoExit = true;
    }
    if (document.pictureInPictureElement) {
      try {
        exitingPiP = true;
        await document.exitPictureInPicture();
      } catch (_) {
      } finally {
        exitingPiP = false;
      }
    }
  }

  // 6. MediaSession Integration for Native PiP & Seek Controls
  function setMediaSessionHandler(action, handler) {
    if (!ms) return;
    try { ms.setActionHandler(action, handler); } catch (_) {}
  }

  function registerMediaSession() {
    if (!ms) return;
    if (cfg.autoPip) {
      setMediaSessionHandler('enterpictureinpicture', () => {
        if (!cfg.autoPip || justExitedPip || Date.now() < suppressAutoEnterUntil) return;
        const v = pickCandidate(true);
        if (v) enterPiP(v, true, false).catch(() => {});
      });
    } else {
      setMediaSessionHandler('enterpictureinpicture', null);
    }
  }

  // 7. Event Listeners for Auto-PiP:
  // Tab visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      autoEnter(false);
    } else {
      autoExit();
    }
  });

  // Window focus & blur tracking (with debounce to ignore in-page iframe clicks)
  let windowBlurTimer = null;
  window.addEventListener('blur', () => {
    if (!cfg.autoPip || busy || exitingPiP || justExitedPip || Date.now() < suppressAutoEnterUntil || document.pictureInPictureElement) return;
    if (windowBlurTimer) clearTimeout(windowBlurTimer);
    windowBlurTimer = setTimeout(() => {
      windowBlurTimer = null;
      // If focus only moved to an iframe on the same page, do not trigger PiP
      if (document.activeElement && (document.activeElement.tagName === 'IFRAME' || document.activeElement.tagName === 'FRAME')) {
        return;
      }
      if (typeof document.hasFocus === 'function' && !document.hasFocus()) {
        autoEnter(true);
      }
    }, 200);
  });

  window.addEventListener('focus', () => {
    if (windowBlurTimer) {
      clearTimeout(windowBlurTimer);
      windowBlurTimer = null;
    }
    autoExit();
  });

  // Track video play/pause to register media session and maintain playback continuity
  document.addEventListener('play', (e) => {
    if (e.target instanceof HTMLVideoElement) {
      isVideoPlaying = true;
      try {
        if (!e.target.autoPictureInPicture) e.target.autoPictureInPicture = true;
        if (!e.target.hasAttribute('autopictureinpicture')) {
          e.target.setAttribute('autopictureinpicture', '');
        }
      } catch (_) {}
      registerMediaSession();
    }
  }, true);

  document.addEventListener('pause', (e) => {
    if (e.target instanceof HTMLVideoElement) {
      // If PiP is active, user may have intentionally paused via PiP controls
      if (document.pictureInPictureElement === e.target) {
        isVideoPlaying = false;
      }
    }
  }, true);

  // 8. Clean return from PiP without black screen or unwanted re-entry
  document.addEventListener('leavepictureinpicture', (e) => {
    autoPipActive = false;
    pendingAutoExit = false;
    justExitedPip = true;
    suppressAutoEnterUntil = Date.now() + 2500;
    setTimeout(() => { justExitedPip = false; }, 2000);

    if (seekHandlersSet) {
      setMediaSessionHandler('seekbackward', null);
      setMediaSessionHandler('seekforward', null);
      seekHandlersSet = false;
    }

    const v = e.target;
    if (v instanceof HTMLVideoElement) {
      // If the browser paused the video on PiP exit, maintain smooth continuity
      if (isVideoPlaying || !v.paused) {
        v.play().catch(() => {});
      }
      // Force hardware repaint / clear frozen interstitial layer & surface rebind
      requestAnimationFrame(() => {
        try {
          const prevDisplay = v.style.display;
          v.style.display = 'inline-block';
          void v.offsetHeight;
          v.style.display = prevDisplay;
        } catch (_) {}
      });
    }

    // Clean up any YouTube player stuck in PiP overlay mode
    try {
      const ytPlayer = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (ytPlayer) {
        ytPlayer.classList.remove('ytp-pip-mode');
        const overlays = ytPlayer.querySelectorAll('.ytp-pip-overlay, [class*="pip-overlay"]');
        for (let i = 0; i < overlays.length; i++) {
          overlays[i].style.display = 'none';
        }
        if (typeof ytPlayer.playVideo === 'function' && isVideoPlaying) {
          ytPlayer.playVideo();
        }
      }
    } catch (_) {}
  }, true);

  // 9. Enter PiP: Set skip backward/forward controls in PiP window
  document.addEventListener('enterpictureinpicture', (e) => {
    const v = e.target;
    if (!ms || !(v instanceof HTMLVideoElement)) return;

    setMediaSessionHandler('seekbackward', (d) => {
      const offset = (d && d.seekOffset) || 10;
      v.currentTime = Math.max(0, v.currentTime - offset);
    });
    setMediaSessionHandler('seekforward', (d) => {
      const offset = (d && d.seekOffset) || 10;
      v.currentTime = Math.min(v.duration || Infinity, v.currentTime + offset);
    });
    seekHandlersSet = true;
  }, true);

  // 10. Manual Toggle & API for commands / popup
  function togglePiP() {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
      return 'exit';
    }
    const v = pickCandidate(false);
    if (!v) return 'none';
    enterPiP(v, false).catch(() => {});
    return 'enter';
  }

  window.__cvPip = { toggle: togglePiP };

  // Runtime message listener for toggle-pip command & background window focus events
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'toggle-pip') {
      const res = togglePiP();
      if (sendResponse) sendResponse({ ok: true, result: res });
      return true;
    }
    if (msg.type === 'cv-window-blur' || msg.type === 'cv-tab-deactivated') {
      autoEnter(true);
      if (sendResponse) sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'cv-window-focus' || msg.type === 'cv-tab-activated') {
      autoExit();
      if (sendResponse) sendResponse({ ok: true });
      return true;
    }
  });

  registerMediaSession();
})();

