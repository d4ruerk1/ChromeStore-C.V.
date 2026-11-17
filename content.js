/**
 * C.V. - Content Script
 * Automatic & Manual Picture-in-Picture Engine
 * Version: 1.3.1
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
  let isPopupOpen = false;
  let popupCooldownUntil = 0;
  let docPipWindow = null;
  let activeTextTrack = null;
  let captionObserver = null;
  let captionPollTimer = null;
  let toastTimeout = null;
  const ms = navigator.mediaSession || null;

  // 1. Sync configuration from storage
  function updateConfig(newVal) {
    if (typeof newVal === 'boolean') {
      cfg.autoPip = newVal;
      if (!cfg.autoPip && document.pictureInPictureElement && autoPipActive) {
        autoExit();
      }
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

  // 3. Candidate evaluation (prioritizing main media)
  function pickCandidate(requirePlaying = false) {
    // Check for YouTube main video directly first to prevent hover-previews from hijacking PiP
    try {
      const ytVid = document.querySelector('#movie_player video.html5-main-video') ||
                    document.querySelector('.html5-video-player video.html5-main-video') ||
                    document.querySelector('video.html5-main-video');
      if (ytVid && !ytVid.ended) {
        try {
          if (ytVid.disablePictureInPicture) ytVid.disablePictureInPicture = false;
          if (ytVid.hasAttribute && ytVid.hasAttribute('disablepictureinpicture')) {
            ytVid.removeAttribute('disablepictureinpicture');
          }
          if (ytVid.autoPictureInPicture) ytVid.autoPictureInPicture = false;
          if (ytVid.hasAttribute && ytVid.hasAttribute('autopictureinpicture')) {
            ytVid.removeAttribute('autopictureinpicture');
          }
        } catch (_) {}
        const isPlaying = !ytVid.paused && (ytVid.currentTime > 0 || ytVid.readyState >= 2);
        if (!requirePlaying || isPlaying) return ytVid;
      }
    } catch (_) {}

    const videos = getAllVideos(document);
    if (!videos.length) return null;

    let best = null;
    let bestScore = -1;

    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      if (!v || v.ended) continue;

      // Unlock PiP permissions if site attempted to block it, and disable browser-level autoPiP (prevents toolbar/popup clicks from triggering PiP)
      try {
        if (v.disablePictureInPicture) v.disablePictureInPicture = false;
        if (v.hasAttribute && v.hasAttribute('disablepictureinpicture')) {
          v.removeAttribute('disablepictureinpicture');
        }
        if (v.autoPictureInPicture) v.autoPictureInPicture = false;
        if (v.hasAttribute && v.hasAttribute('autopictureinpicture')) {
          v.removeAttribute('autopictureinpicture');
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

  // 4. Real-time Subtitle & Caption Engine for PiP
  function ensureCaptionsActive(v) {
    if (!v) return;

    // A. Activate YouTube Captions in user language or video language
    try {
      const yt = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (yt && typeof yt.getOption === 'function') {
        const tracklist = yt.getOption('captions', 'tracklist') || [];
        if (tracklist.length > 0) {
          const userLang = (navigator.language || 'it').slice(0, 2).toLowerCase();
          let targetTrack = tracklist.find(t => t.languageCode && t.languageCode.toLowerCase() === userLang);
          if (!targetTrack) {
            targetTrack = tracklist.find(t => !t.isDefault) || tracklist[0];
          }
          if (targetTrack && typeof yt.setOption === 'function') {
            yt.setOption('captions', 'track', targetTrack);
          }
        }
        if (typeof yt.toggleSubtitlesOn === 'function' && (!yt.isSubtitlesOn || !yt.isSubtitlesOn())) {
          yt.toggleSubtitlesOn();
        }
      }
    } catch (_) {}

    // B. Create / get standard TextTrack for native PiP window rendering
    try {
      if (!activeTextTrack) {
        for (let i = 0; i < v.textTracks.length; i++) {
          if (v.textTracks[i].label === 'C.V. Subtitles') {
            activeTextTrack = v.textTracks[i];
            break;
          }
        }
      }
      if (!activeTextTrack) {
        activeTextTrack = v.addTextTrack('captions', 'C.V. Subtitles', (navigator.language || 'it').slice(0, 2));
      }
      activeTextTrack.mode = 'showing';
    } catch (_) {}

    // C. Watch for real-time caption DOM changes and mirror into TextTrack cues
    const updateCaptions = () => {
      try {
        const segments = document.querySelectorAll('.ytp-caption-segment, .caption-window');
        if (!segments || segments.length === 0) return;
        const text = Array.from(segments).map(s => s.textContent.trim()).filter(Boolean).join('\n');
        if (text && activeTextTrack && v && !v.paused) {
          const now = v.currentTime;
          if (activeTextTrack.cues) {
            for (let i = activeTextTrack.cues.length - 1; i >= 0; i--) {
              const c = activeTextTrack.cues[i];
              if (c && c.endTime < now - 0.5) {
                try { activeTextTrack.removeCue(c); } catch (_) {}
              }
            }
          }
          const cue = new VTTCue(now, now + 3.5, text);
          activeTextTrack.addCue(cue);
        }
      } catch (_) {}
    };

    if (!captionObserver) {
      try {
        const targetNode = document.querySelector('.ytp-caption-window-container') ||
                           document.querySelector('#movie_player .ytp-caption-window-container');
        if (targetNode) {
          captionObserver = new MutationObserver(updateCaptions);
          captionObserver.observe(targetNode, { childList: true, subtree: true, characterData: true });
        } else if (!captionPollTimer) {
          captionPollTimer = setInterval(() => {
            const isPip = (document.pictureInPictureElement === v) || (docPipWindow && !docPipWindow.closed);
            if (!isPip) {
              clearInterval(captionPollTimer);
              captionPollTimer = null;
              return;
            }
            const container = document.querySelector('.ytp-caption-window-container');
            if (container && !captionObserver) {
              clearInterval(captionPollTimer);
              captionPollTimer = null;
              captionObserver = new MutationObserver(updateCaptions);
              captionObserver.observe(container, { childList: true, subtree: true, characterData: true });
            }
            updateCaptions();
          }, 250);
        }
      } catch (_) {}
    }
  }

  function showPipToast(text, v) {
    if (!activeTextTrack || !v) return;
    try {
      const now = v.currentTime;
      const toastCue = new VTTCue(now, now + 2.0, `[ ${text} ]`);
      activeTextTrack.addCue(toastCue);
      if (toastTimeout) clearTimeout(toastTimeout);
      toastTimeout = setTimeout(() => {
        try { activeTextTrack.removeCue(toastCue); } catch (_) {}
      }, 2000);
    } catch (_) {}
  }

  // 5. Document Picture-in-Picture with Interactive Speed & Subtitle Controls
  async function openDocumentPiP(v) {
    if (!v || typeof window.documentPictureInPicture === 'undefined' || typeof window.documentPictureInPicture.requestWindow !== 'function') {
      return false;
    }
    try {
      const pipWin = await window.documentPictureInPicture.requestWindow({
        width: 540,
        height: 340,
      });

      docPipWindow = pipWin;

      // Copy page stylesheets into Document PiP window
      [...document.styleSheets].forEach((styleSheet) => {
        try {
          const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
          const style = pipWin.document.createElement('style');
          style.textContent = cssRules;
          pipWin.document.head.appendChild(style);
        } catch (_) {}
      });

      pipWin.document.body.style.margin = '0';
      pipWin.document.body.style.padding = '0';
      pipWin.document.body.style.background = '#000';
      pipWin.document.body.style.overflow = 'hidden';
      pipWin.document.body.style.display = 'flex';
      pipWin.document.body.style.flexDirection = 'column';
      pipWin.document.body.style.justifyContent = 'center';
      pipWin.document.body.style.alignItems = 'center';
      pipWin.document.body.style.position = 'relative';

      const container = pipWin.document.createElement('div');
      container.style.cssText = 'position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#000;';

      const origParent = v.parentNode;
      const origSibling = v.nextSibling;

      v.style.maxWidth = '100%';
      v.style.maxHeight = '100%';
      container.appendChild(v);

      // Real-time subtitle box in Document PiP
      const subBox = pipWin.document.createElement('div');
      subBox.style.cssText = 'position:absolute;bottom:54px;left:50%;transform:translateX(-50%);max-width:90%;color:#fff;background:rgba(0,0,0,0.75);font-family:Roboto,sans-serif;font-size:15px;font-weight:500;padding:4px 10px;border-radius:4px;text-align:center;pointer-events:none;z-index:9999;display:none;';
      container.appendChild(subBox);

      // Speed & control bar in Document PiP
      const toolbar = pipWin.document.createElement('div');
      toolbar.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:44px;background:rgba(18,18,24,0.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:space-between;padding:0 12px;box-sizing:border-box;z-index:9999;';

      const updateSpeedDisplay = (spd) => {
        spdVal.textContent = spd.toFixed(2).replace(/\.00$/, '') + 'x';
      };

      const speedGroup = pipWin.document.createElement('div');
      speedGroup.style.cssText = 'display:flex;align-items:center;gap:6px;';

      const btnMinus = pipWin.document.createElement('button');
      btnMinus.textContent = '−';
      btnMinus.style.cssText = 'width:28px;height:28px;border-radius:4px;border:none;background:#2a2b36;color:#fff;font-size:16px;font-weight:bold;cursor:pointer;';
      btnMinus.onclick = () => {
        const cur = window.__cvRate || v.playbackRate || 1.0;
        const next = Math.max(0.25, Math.round((cur - 0.25) * 100) / 100);
        if (window.__cvSetSafePlaybackRate) window.__cvSetSafePlaybackRate(next);
        else v.playbackRate = next;
        api.runtime.sendMessage({ type: 'setSpeed', speed: next }).catch(() => {});
        updateSpeedDisplay(next);
      };

      const spdVal = pipWin.document.createElement('span');
      spdVal.style.cssText = 'color:#ff6b4a;font-family:monospace;font-size:14px;font-weight:700;min-width:44px;text-align:center;';
      updateSpeedDisplay(window.__cvRate || v.playbackRate || 1.0);

      const btnPlus = pipWin.document.createElement('button');
      btnPlus.textContent = '+';
      btnPlus.style.cssText = 'width:28px;height:28px;border-radius:4px;border:none;background:#2a2b36;color:#fff;font-size:16px;font-weight:bold;cursor:pointer;';
      btnPlus.onclick = () => {
        const cur = window.__cvRate || v.playbackRate || 1.0;
        const next = Math.min(5.0, Math.round((cur + 0.25) * 100) / 100);
        if (window.__cvSetSafePlaybackRate) window.__cvSetSafePlaybackRate(next);
        else v.playbackRate = next;
        api.runtime.sendMessage({ type: 'setSpeed', speed: next }).catch(() => {});
        updateSpeedDisplay(next);
      };

      const presetGroup = pipWin.document.createElement('div');
      presetGroup.style.cssText = 'display:flex;align-items:center;gap:4px;margin-left:8px;';
      [1.0, 1.5, 2.0, 3.0, 5.0].forEach(p => {
        const b = pipWin.document.createElement('button');
        b.textContent = p + 'x';
        b.style.cssText = 'padding:3px 7px;border-radius:4px;border:none;background:#1e1f29;color:#aaa;font-size:11px;cursor:pointer;';
        b.onclick = () => {
          if (window.__cvSetSafePlaybackRate) window.__cvSetSafePlaybackRate(p);
          else v.playbackRate = p;
          api.runtime.sendMessage({ type: 'setSpeed', speed: p }).catch(() => {});
          updateSpeedDisplay(p);
        };
        presetGroup.appendChild(b);
      });

      speedGroup.appendChild(btnMinus);
      speedGroup.appendChild(spdVal);
      speedGroup.appendChild(btnPlus);
      speedGroup.appendChild(presetGroup);
      toolbar.appendChild(speedGroup);
      container.appendChild(toolbar);
      pipWin.document.body.appendChild(container);

      // Subtitle polling in Document PiP
      const subTimer = setInterval(() => {
        try {
          const segments = document.querySelectorAll('.ytp-caption-segment, .caption-window');
          if (segments && segments.length > 0) {
            const txt = Array.from(segments).map(s => s.textContent.trim()).filter(Boolean).join(' ');
            if (txt) {
              subBox.textContent = txt;
              subBox.style.display = 'block';
            } else {
              subBox.style.display = 'none';
            }
          } else {
            subBox.style.display = 'none';
          }
        } catch (_) {}
      }, 100);

      const handleClose = () => {
        clearInterval(subTimer);
        docPipWindow = null;
        try {
          if (origSibling) {
            origParent.insertBefore(v, origSibling);
          } else {
            origParent.appendChild(v);
          }
          cleanPiPOverlays(v);
        } catch (_) {}
      };

      pipWin.addEventListener('pagehide', handleClose);
      pipWin.addEventListener('unload', handleClose);

      ensureCaptionsActive(v);
      return true;
    } catch (_) {
      return false;
    }
  }

  // 6. Request Picture-in-Picture
  async function enterPiP(v, isAuto, force = false) {
    if (!v || busy || exitingPiP) return;
    if (Date.now() < suppressAutoEnterUntil) return;
    if (document.pictureInPictureElement || (docPipWindow && !docPipWindow.closed)) return;

    // Never auto-enter PiP if popup is open or if tab is still visible
    if (isAuto) {
      if (isPopupOpen || Date.now() < popupCooldownUntil) return;
      if (!force && !document.hidden) return;
    }

    try {
      busy = true;
      pendingAutoExit = false;

      if (v.disablePictureInPicture) v.disablePictureInPicture = false;
      if (v.hasAttribute && v.hasAttribute('disablepictureinpicture')) {
        v.removeAttribute('disablepictureinpicture');
      }
      try {
        if (v.autoPictureInPicture) v.autoPictureInPicture = false;
        if (v.hasAttribute && v.hasAttribute('autopictureinpicture')) {
          v.removeAttribute('autopictureinpicture');
        }
      } catch (_) {}

      isVideoPlaying = !v.paused;
      autoPipActive = isAuto;

      // Ensure subtitles are active and bound to TextTrack before entering PiP
      ensureCaptionsActive(v);

      await v.requestPictureInPicture();

      if (pendingAutoExit && document.pictureInPictureElement) {
        pendingAutoExit = false;
        exitingPiP = true;
        await document.exitPictureInPicture().catch(() => {});
        exitingPiP = false;
      }
    } catch (_) {
      autoPipActive = false;
    } finally {
      busy = false;
      pendingAutoExit = false;
    }
  }

  // 7. Auto PiP Handlers: triggered only when tab is hidden (tab switch or window minimize)
  function autoEnter(force = false) {
    if (!cfg.autoPip || busy || exitingPiP || justExitedPip || Date.now() < suppressAutoEnterUntil || document.pictureInPictureElement || (docPipWindow && !docPipWindow.closed)) return;
    if (isPopupOpen || Date.now() < popupCooldownUntil) return;
    if (!force && !document.hidden) return;

    const v = pickCandidate(true);
    if (v) {
      enterPiP(v, true, force).catch(() => {});
    }
  }

  // Clean overlays and black screens thoroughly across all video platforms
  function cleanPiPOverlays(targetVideo) {
    try {
      const pipContainers = document.querySelectorAll('.ytp-pip-mode, .ytp-pip-active, [class*="pip-mode"]');
      for (let i = 0; i < pipContainers.length; i++) {
        pipContainers[i].classList.remove('ytp-pip-mode');
        pipContainers[i].classList.remove('ytp-pip-active');
      }

      const overlays = document.querySelectorAll('.ytp-pip-overlay, .ytp-pip-placeholder, [class*="pip-overlay"], [class*="pip-placeholder"], .ytp-bezel');
      for (let j = 0; j < overlays.length; j++) {
        overlays[j].style.setProperty('display', 'none', 'important');
        overlays[j].style.setProperty('visibility', 'hidden', 'important');
        overlays[j].style.setProperty('opacity', '0', 'important');
        try { overlays[j].remove(); } catch (_) {}
      }

      const ytPlayers = document.querySelectorAll('#movie_player, .html5-video-player, .ytp-player');
      for (let i = 0; i < ytPlayers.length; i++) {
        const yt = ytPlayers[i];
        yt.classList.remove('ytp-pip-mode');
        yt.classList.remove('ytp-pip-active');
        if (typeof yt.playVideo === 'function') {
          try {
            const st = yt.getPlayerState ? yt.getPlayerState() : -1;
            if (st !== 1) yt.playVideo();
          } catch (_) {}
        }
      }
    } catch (_) {}

    const v = targetVideo || pickCandidate(false);
    if (v instanceof HTMLVideoElement) {
      try {
        if (v.paused) {
          v.play().catch(() => {});
        }
      } catch (_) {}
    }
  }

  async function autoExit() {
    suppressAutoEnterUntil = Date.now() + 1500;
    autoPipActive = false;
    pendingAutoExit = false;

    if (captionObserver) {
      try { captionObserver.disconnect(); } catch (_) {}
      captionObserver = null;
    }
    if (captionPollTimer) {
      clearInterval(captionPollTimer);
      captionPollTimer = null;
    }

    if (docPipWindow && !docPipWindow.closed) {
      try { docPipWindow.close(); } catch (_) {}
      docPipWindow = null;
    }

    if (document.pictureInPictureElement) {
      try {
        exitingPiP = true;
        await document.exitPictureInPicture();
      } catch (_) {
      } finally {
        exitingPiP = false;
        cleanPiPOverlays();
      }
    } else {
      cleanPiPOverlays();
    }
  }

  // 8. MediaSession Integration for Native PiP, Speed Controls & Seek
  function setMediaSessionHandler(action, handler) {
    if (!ms) return;
    try { ms.setActionHandler(action, handler); } catch (_) {}
  }

  function updateMediaSessionControls(v) {
    if (!ms || !v) return;

    setMediaSessionHandler('seekbackward', (d) => {
      const offset = (d && d.seekOffset) || 10;
      v.currentTime = Math.max(0, v.currentTime - offset);
    });

    setMediaSessionHandler('seekforward', (d) => {
      const offset = (d && d.seekOffset) || 10;
      v.currentTime = Math.min(v.duration || Infinity, v.currentTime + offset);
    });

    // Speed Control directly inside native PiP via Previous/Next track buttons (|<< and >>|)
    setMediaSessionHandler('previoustrack', () => {
      const cur = window.__cvRate || v.playbackRate || 1.0;
      const nextSpd = Math.max(0.25, Math.round((cur - 0.25) * 100) / 100);
      if (typeof window.__cvSetSafePlaybackRate === 'function') {
        window.__cvSetSafePlaybackRate(nextSpd);
      } else {
        v.playbackRate = nextSpd;
      }
      api.runtime.sendMessage({ type: 'setSpeed', speed: nextSpd }).catch(() => {});
      showPipToast(`⚡ ${nextSpd}x`, v);
    });

    setMediaSessionHandler('nexttrack', () => {
      const cur = window.__cvRate || v.playbackRate || 1.0;
      const nextSpd = Math.min(5.0, Math.round((cur + 0.25) * 100) / 100);
      if (typeof window.__cvSetSafePlaybackRate === 'function') {
        window.__cvSetSafePlaybackRate(nextSpd);
      } else {
        v.playbackRate = nextSpd;
      }
      api.runtime.sendMessage({ type: 'setSpeed', speed: nextSpd }).catch(() => {});
      showPipToast(`⚡ ${nextSpd}x`, v);
    });

    seekHandlersSet = true;
  }

  function registerMediaSession() {
    if (!ms) return;
    if (cfg.autoPip) {
      setMediaSessionHandler('enterpictureinpicture', () => {
        if (!cfg.autoPip || justExitedPip || isPopupOpen || Date.now() < popupCooldownUntil || Date.now() < suppressAutoEnterUntil) return;
        if (!document.hidden) return;
        const v = pickCandidate(true);
        if (v) enterPiP(v, true, true).catch(() => {});
      });
    } else {
      setMediaSessionHandler('enterpictureinpicture', null);
    }
  }

  // 9. Event Listeners for Tab Changes & Visibility:
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      autoEnter(false);
    } else {
      // Returning to tab: unconditionally exit PiP, restore video, and nuke black overlay!
      autoExit();
    }
  });

  // Fail-safe Heartbeat Watcher:
  setInterval(() => {
    const pipEl = document.pictureInPictureElement;
    if (!pipEl && (!docPipWindow || docPipWindow.closed)) {
      const stuck = document.querySelector('.ytp-pip-mode, .ytp-pip-overlay, .ytp-pip-placeholder, [class*="pip-overlay"]');
      if (stuck) {
        cleanPiPOverlays();
      }
    }

    if (!cfg.autoPip || busy || exitingPiP || justExitedPip || isPopupOpen || Date.now() < popupCooldownUntil || Date.now() < suppressAutoEnterUntil) return;

    if (pipEl || (docPipWindow && !docPipWindow.closed)) {
      if (!document.hidden && autoPipActive) {
        autoExit();
      }
    } else {
      // Trigger Auto-PiP ONLY when tab is actually hidden (tab switch or window minimize)
      if (document.hidden) {
        const v = pickCandidate(true);
        if (v) {
          enterPiP(v, true, true).catch(() => {});
        }
      }
    }
  }, 500);

  // Track video play/pause to register media session and maintain playback continuity
  document.addEventListener('play', (e) => {
    if (e.target instanceof HTMLVideoElement) {
      isVideoPlaying = true;
      try {
        if (e.target.autoPictureInPicture) e.target.autoPictureInPicture = false;
        if (e.target.hasAttribute && e.target.hasAttribute('autopictureinpicture')) {
          e.target.removeAttribute('autopictureinpicture');
        }
      } catch (_) {}
      ensureCaptionsActive(e.target);
      updateMediaSessionControls(e.target);
      registerMediaSession();
    }
  }, true);

  document.addEventListener('pause', (e) => {
    if (e.target instanceof HTMLVideoElement) {
      if (document.pictureInPictureElement === e.target || (docPipWindow && !docPipWindow.closed)) {
        isVideoPlaying = false;
      }
    }
  }, true);

  // 10. Clean return from PiP without black screen or stuck overlays
  document.addEventListener('leavepictureinpicture', (e) => {
    autoPipActive = false;
    pendingAutoExit = false;
    justExitedPip = true;
    suppressAutoEnterUntil = Date.now() + 1500;
    setTimeout(() => { justExitedPip = false; }, 1500);

    if (captionObserver) {
      try { captionObserver.disconnect(); } catch (_) {}
      captionObserver = null;
    }
    if (captionPollTimer) {
      clearInterval(captionPollTimer);
      captionPollTimer = null;
    }

    const v = e.target;
    cleanPiPOverlays(v);
    setTimeout(() => cleanPiPOverlays(v), 100);
  }, true);

  document.addEventListener('enterpictureinpicture', (e) => {
    const v = e.target;
    ensureCaptionsActive(v);
    updateMediaSessionControls(v);
  }, true);

  // 11. Manual Toggle & API for commands / popup
  async function togglePiP() {
    if (docPipWindow && !docPipWindow.closed) {
      docPipWindow.close();
      docPipWindow = null;
      cleanPiPOverlays();
      return 'exit';
    }
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
      cleanPiPOverlays();
      return 'exit';
    }

    const v = pickCandidate(false);
    if (!v) return 'none';

    // Try Document Picture-in-Picture first (interactive speed controls + styled subtitles)
    const docPipSuccess = await openDocumentPiP(v);
    if (docPipSuccess) return 'enter';

    // Fallback to native PiP
    enterPiP(v, false, true).catch(() => {});
    return 'enter';
  }

  window.__cvPip = { toggle: togglePiP };

  // Runtime message listener for toggle-pip command & background window focus events
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'toggle-pip') {
      togglePiP().then(res => {
        if (sendResponse) sendResponse({ ok: true, result: res });
      });
      return true;
    }
    if (msg.type === 'cv-popup-state') {
      isPopupOpen = !!msg.open;
      if (isPopupOpen) {
        suppressAutoEnterUntil = Math.max(suppressAutoEnterUntil, Date.now() + 3000);
        // If PiP was accidentally triggered right as the popup was opened, immediately restore video in page
        if (autoPipActive && (document.pictureInPictureElement || (docPipWindow && !docPipWindow.closed))) {
          autoExit();
        }
      } else {
        popupCooldownUntil = Date.now() + 1500;
      }
      if (sendResponse) sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'cv-window-minimize' || msg.type === 'cv-tab-deactivated') {
      autoEnter(true);
      if (sendResponse) sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'cv-tab-activated') {
      autoExit();
      if (sendResponse) sendResponse({ ok: true });
      return true;
    }
  });

  registerMediaSession();
})();
