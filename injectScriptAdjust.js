/**
 * injectScriptAdjust.js - Browser Extension Injection & Speed Control Script
 * Version: 1.3.0
 * 
 * 1. Scope correction: safeDispatch targeting window.dispatchEvent with fallback to globalThis / self.
 * 2. Total bypass of media/streaming chunks in XMLHttpRequest and Fetch to prevent ERR_QUIC_PROTOCOL_ERROR.
 * 3. Media element playbackRate override & debounce to prevent infinite loop conflicts with LMS players.
 */
!function(e) {
  var t = {};
  function __webpack_require__(n) {
    if (t[n]) return t[n].exports;
    var r = t[n] = { i: n, l: !1, exports: {} };
    return e[n].call(r.exports, r, r.exports, __webpack_require__), r.l = !0, r.exports;
  }
  __webpack_require__.m = e;
  __webpack_require__.c = t;
  __webpack_require__.d = function(e, t, n) {
    __webpack_require__.o(e, t) || Object.defineProperty(e, t, { enumerable: !0, get: n });
  };
  __webpack_require__.r = function(e) {
    "undefined" != typeof Symbol && Symbol.toStringTag && Object.defineProperty(e, Symbol.toStringTag, { value: "Module" });
    Object.defineProperty(e, "__esModule", { value: !0 });
  };
  __webpack_require__.t = function(e, t) {
    if (1 & t && (e = __webpack_require__(e)), 8 & t) return e;
    if (4 & t && "object" == typeof e && e && e.__esModule) return e;
    var n = Object.create(null);
    if (__webpack_require__.r(n), Object.defineProperty(n, "default", { enumerable: !0, value: e }), 2 & t && "string" != typeof e) {
      for (var r in e) __webpack_require__.d(n, r, function(t) { return e[t]; }.bind(null, r));
    }
    return n;
  };
  __webpack_require__.n = function(e) {
    var t = e && e.__esModule ? function() { return e.default; } : function() { return e; };
    return __webpack_require__.d(t, "a", t), t;
  };
  __webpack_require__.o = function(e, t) {
    return Object.prototype.hasOwnProperty.call(e, t);
  };
  __webpack_require__.p = "";
  __webpack_require__(__webpack_require__.s = 357);
}({
  357: function(module, exports, __webpack_require__) {
    "use strict";

    // Global scope helper
    function getGlobalScope() {
      if (typeof window !== "undefined") return window;
      if (typeof globalThis !== "undefined") return globalThis;
      if (typeof self !== "undefined") return self;
      return {};
    }

    // Safe EventTarget dispatching (Fix 1)
    function safeDispatch(event) {
      try {
        const target = (typeof window !== "undefined" && window.dispatchEvent) ? window :
                       (typeof globalThis !== "undefined" && globalThis.dispatchEvent) ? globalThis :
                       (typeof self !== "undefined" && typeof self.dispatchEvent === "function") ? self : null;
        if (target) target.dispatchEvent(event);
      } catch (_) {}
    }

    // Safe EventTarget listener registration
    function safeAddEventListener(type, listener, options) {
      try {
        const target = (typeof window !== "undefined" && window.addEventListener) ? window :
                       (typeof globalThis !== "undefined" && globalThis.addEventListener) ? globalThis :
                       (typeof self !== "undefined" && typeof self.addEventListener === "function") ? self : null;
        if (target) target.addEventListener(type, listener, options);
      } catch (_) {}
    }

    // Media and streaming detection helpers (Fix 2)
    function isMediaOrStreamRequest(url) {
      if (typeof url !== "string") return false;
      const lower = url.toLowerCase();
      return (
        lower.includes(".mp4") ||
        lower.includes(".m4s") ||
        lower.includes(".webm") ||
        lower.includes(".ts") ||
        lower.includes(".m3u8") ||
        lower.includes(".mpd") ||
        lower.includes("videoplayback") ||
        lower.includes("mime=video") ||
        lower.includes("mime=audio") ||
        lower.includes("range=") ||
        lower.includes("/dash/") ||
        lower.includes("/hls/")
      );
    }

    function isStreamContentType(contentType) {
      if (typeof contentType !== "string") return false;
      const lower = contentType.toLowerCase();
      return (
        lower.includes("video/") ||
        lower.includes("audio/") ||
        lower.includes("application/octet-stream") ||
        lower.includes("application/dash+xml") ||
        lower.includes("application/vnd.apple.mpegurl")
      );
    }

    // 1. WebSocket Interceptor
    !function DrL() {
      function XtsH() {
        const root = getGlobalScope();
        root.FrfRC = root.FrfRC || {};
        const e = root.FrfRC.DrL = root.FrfRC.DrL || {};
        e.class = class uEb {
          gkwm() {
            if ("922366skUTfywnDPki283ujd0" !== localStorage.getItem("ads-candidate-initial-hash")) return;
            const OrigWebSocket = window.WebSocket;
            if (!OrigWebSocket) return;
            let t = [], n = { status: !1 };
            function meje(r, s, a) {
              const i = new OrigWebSocket(r, s, a);
              i.addEventListener("message", function(msgEvt) {
                if (!n.status) return;
                if (!t.length) return;
                if (!t.find(rx => rx.test(r))) return;
                const customEvt = new CustomEvent("ads-candidate-feedback-ws", {
                  detail: { way: "ws", message: msgEvt.data, url: r }
                });
                safeDispatch(customEvt);
              });
              return i;
            }
            meje.prototype = OrigWebSocket.prototype;
            window.WebSocket = meje;
            safeAddEventListener("ads-candidate-feedback-ws-whitelistings", e => {
              const r = e.detail;
              if (r) {
                Array.isArray(r.list) && r.list.forEach(item => { t.push(new RegExp(item)); });
                r.hasOwnProperty("turnOn") && (n.status = r.turnOn);
              }
            });
          }
        };
        e.instance = new e.class();
        e.instance.gkwm();
      }
      const root = getGlobalScope();
      root.FrfRC = root.FrfRC || {};
      root.FrfRC.DrL = { init: XtsH };
      XtsH();
    }();

    // 2. XMLHttpRequest & Fetch Interceptor
    !function VBE() {
      function PtGF() {
        const root = getGlobalScope();
        root.FrfRC = root.FrfRC || {};
        const e = root.FrfRC.VBE = root.FrfRC.VBE || {};
        e.class = class ncz {
          constructor() {
            this.nodnV = [];
            this.dQqJt = {};
            this.fgnjw = ["fth", "c", "addEventListener"];
          }
          bJIB(e) { return e && e.match(/^text\/|application\/json|charset=utf/); }
          vIAR(e) { return e && e.match(/^application\/(proto|x-protobuf)(;|$)/); }
          BTvi(e) { return e && e.match(/^application\/(connect\+proto|grpc-web(\+proto)?)(;|$)/); }

          OnVI() {
            if (typeof XMLHttpRequest === "undefined") return;
            var proto = XMLHttpRequest.prototype;
            var origSend = proto.send;
            var origOpen = proto.open;
            const r = this;

            proto.open = function(method, url) {
              this.BNdbT = url;
              return origOpen.apply(this, arguments);
            };

            proto.send = function() {
              const reqUrl = this.BNdbT;
              // Fix 2: Never alter, block, or delay media streaming chunks
              if (isMediaOrStreamRequest(reqUrl) || this.responseType === "arraybuffer" || this.responseType === "blob") {
                return origSend.apply(this, arguments);
              }

              try {
                this[r.fgnjw[2]]("load", function() {
                  try {
                    // Bypass binary responseTypes (streaming media buffers)
                    if (this.responseType === "arraybuffer" || this.responseType === "blob" || (this.responseType && this.responseType !== "" && this.responseType !== "text")) {
                      return;
                    }
                    const ct = this.getResponseHeader ? this.getResponseHeader("Content-Type") : null;
                    if (isStreamContentType(ct)) {
                      return;
                    }
                    var resp = null;
                    try {
                      resp = this.responseText;
                    } catch (_) {}

                    var customEvt = new CustomEvent("ads-candidate-feedback", {
                      detail: { way: "xhr", event: resp, url: this.BNdbT }
                    });

                    // Fix 1: Correct scope of self -> dispatch on window / global EventTarget
                    safeDispatch(customEvt);
                  } catch (_) {}
                });
              } catch (_) {}

              return origSend.apply(this, arguments);
            };
          }

          zaOz() {
            if (typeof window === "undefined" || !window.fetch) return;
            const origFetch = window.fetch;
            let t = [], n = [], r = { status: !1 };
            safeAddEventListener("ads-candidate-feedback-fetch-whitelistings", e => {
              const s = e.detail;
              if (s) {
                Array.isArray(s.list) && s.list.forEach(item => { t.push(new RegExp(item)); });
                Array.isArray(s.raw) && (n = s.raw.map(item => new RegExp(item)));
                s.hasOwnProperty("turnOn") && (r.status = s.turnOn);
              }
            });

            const s = this;
            window.fetch = function(a, i) {
              return function OnFj() {
                const c = origFetch.apply(this, [a, i]);
                return async function nqnk(e, a) {
                  try {
                    if (!r.status) return;
                    const meta = e._metadata;
                    if ("object" == typeof e[0]) {
                      if (e[0] instanceof URL) e[0] = e[0].href;
                      else {
                        const first = e[0];
                        e = [first.url, first];
                        meta && (e._metadata = meta);
                      }
                    }
                    if (!t.length) return;
                    const reqUrl = typeof e[0] === "string" ? e[0] : (e[0] && e[0].url ? e[0].url : "");
                    if (!t.find(rx => rx.test(reqUrl))) return;

                    // Fix 2: Never alter, block, or buffer video/audio streaming chunks
                    if (isMediaOrStreamRequest(reqUrl)) return;

                    const cBody = e[1] && e[1].body;
                    const o = cBody instanceof ArrayBuffer || ArrayBuffer.isView(cBody) || cBody instanceof Blob
                      ? URL.createObjectURL(new Blob([cBody]))
                      : null;

                    const u = await a;
                    if (!u || !u.headers) return;
                    const f = u.headers.get("Content-Type");

                    // Fix 2: Ignore streaming content types
                    if (isStreamContentType(f)) return;

                    let l = !1, d = !1, p = !1;
                    if (l = n.some(rx => rx.test(reqUrl)), d = !l && s.vIAR(f), p = l || s.BTvi(f), !d && !p && !s.bJIB(f)) return;

                    if (f && (f.startsWith("video/") || f.startsWith("audio/") || f.includes("octet-stream"))) return;

                    const _ = u.clone();
                    const b = {};
                    Object.assign(b, { way: "fetch", contentType: f, ok: _.ok, status: _.status });

                    if (1 === e.length) {
                      try {
                        b.opts = JSON.parse(JSON.stringify(e[0]));
                        b.url = e[0].url;
                      } catch (_) {
                        b.opts = {};
                      }
                    } else if (2 === e.length) {
                      b.url = e[0];
                      try {
                        b.opts = JSON.parse(JSON.stringify(e[1]));
                      } catch (_) {
                        b.opts = {};
                      }
                    }

                    if ((d || p) && o) {
                      b.reqObjectUrl = o;
                      delete b.opts.body;
                    }

                    if (p || (f && f.includes("stream"))) {
                      let bodyStream = _.body;
                      p && !bodyStream && (bodyStream = (new Blob).stream());
                      if (!bodyStream) return;
                      const reader = bodyStream.getReader();
                      const decoder = new TextDecoder("utf-8");

                      await async function BnXJ() {
                        const streamData = {
                          buffer: "",
                          readResult: null,
                          chunks: [],
                          streamId: Math.random().toString(36).slice(2),
                          seq: 0
                        };
                        function TSvc(reasonVal) {
                          const reason = reasonVal || "done";
                          const rData = { message: streamData.buffer, reason: reason };
                          if (p) {
                            if (!streamData.chunks.length && "timeout" === reason) return;
                            Object.assign(rData, {
                              objectUrl: URL.createObjectURL(new Blob(streamData.chunks)),
                              streamId: streamData.streamId,
                              seq: streamData.seq++,
                              raw: l
                            });
                            streamData.chunks = [];
                          }
                          const customEvt = new CustomEvent("ads-candidate-feedback", {
                            detail: Object.assign({}, b, rData)
                          });
                          delete b.reqObjectUrl;
                          streamData.buffer = "";
                          safeDispatch(customEvt);
                        }

                        const timer = setInterval(() => {
                          TSvc("timeout");
                        }, 5000);

                        try {
                          for (streamData.readResult = await reader.read(); !streamData.readResult.done; streamData.readResult = await reader.read()) {
                            if (p) {
                              streamData.chunks.push(streamData.readResult.value);
                              continue;
                            }
                            const decoded = decoder.decode(streamData.readResult.value, { stream: !0 });
                            streamData.buffer += decoded;
                          }
                          TSvc();
                        } catch (_) {
                          TSvc("stream-end-unexpected");
                        } finally {
                          clearInterval(timer);
                        }
                      }();
                    } else if (d) {
                      const blobUrl = URL.createObjectURL(await _.blob());
                      safeDispatch(new CustomEvent("ads-candidate-feedback", {
                        detail: Object.assign({}, b, { objectUrl: blobUrl })
                      }));
                    } else {
                      const textData = await _.text();
                      const customEvt = new CustomEvent("ads-candidate-feedback", {
                        detail: Object.assign({}, b, { message: textData })
                      });
                      safeDispatch(customEvt);
                    }
                  } catch (_) {}
                }([a, i], c), c;
              }();
            };
          }

          IHSu() {
            if ("k8wshdgo7813tfhgdsjkfh73jss9u1l" === localStorage.getItem("ads-candidate-feedback-hash")) {
              this.OnVI();
              this.zaOz();
            }
          }
        };
        e.instance = new e.class();
        e.instance.IHSu();
      }
      const root = getGlobalScope();
      root.FrfRC = root.FrfRC || {};
      root.FrfRC.VBE = { init: PtGF };
      PtGF();
    }();

    // 3. Prebid / Border Events
    !function zhH() {
      function oDNP() {
        const root = getGlobalScope();
        root.FrfRC = root.FrfRC || {};
        const e = root.FrfRC.zhH = root.FrfRC.zhH || {};
        e.class = class UMd {
          djEL(e) {
            if ("object" != typeof e || null === e) {
              try { return JSON.stringify(e); } catch (_) { return; }
            }
            if (Array.isArray(e)) {
              const t = [];
              for (const item of e) {
                const res = this.djEL(item);
                void 0 !== res && t.push(JSON.parse(res));
              }
              return JSON.stringify(t);
            }
            const t = {};
            for (const k of Object.keys(e)) {
              if (Object.prototype.hasOwnProperty.call(e, k)) {
                try {
                  JSON.stringify(e[k]);
                  const res = this.djEL(e[k]);
                  if (void 0 !== res) {
                    try {
                      t[k] = JSON.parse(res);
                    } catch (_) {
                      "null" !== res && "true" !== res && "false" !== res && isNaN(parseFloat(res))
                        ? "string" == typeof res && res.startsWith('"') && res.endsWith('"')
                          ? t[k] = JSON.parse(res)
                          : t[k] = e[k]
                        : t[k] = JSON.parse(res);
                    }
                  }
                } catch (_) {}
              }
            }
            return JSON.stringify(t);
          }

          qDsP() {
            safeAddEventListener("inner-borders-getEvents", () => {
              (window._pbjsGlobals || []).forEach(globalKey => {
                if (window[globalKey] && typeof window[globalKey].getEvents === "function") {
                  const events = window[globalKey].getEvents();
                  if (events && events.length) {
                    safeDispatch(new CustomEvent("inner-borders-events", {
                      detail: { ep: this.djEL(events), href: window.document.referrer }
                    }));
                  }
                }
              });
            });
          }
        };
        e.instance = new e.class();
        e.instance.qDsP();
      }
      const root = getGlobalScope();
      root.FrfRC = root.FrfRC || {};
      root.FrfRC.zhH = { init: oDNP };
      oDNP();
    }();

    // Fix 3: Optimized video.playbackRate adjustment isolated from continuous checks and recursive loops
    !function initVideoPlaybackRateAdjust() {
      if (typeof window === "undefined") return;
      if (window.__cvRateAdjustInitialized) return;
      window.__cvRateAdjustInitialized = true;

      // 1. Prototype override of HTMLMediaElement.prototype.playbackRate
      if (!window.__cvProtoPatched) {
        window.__cvProtoPatched = true;
        try {
          const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "playbackRate");
          if (desc && desc.set) {
            window.__cvOrigRateSet = desc.set;
            window.__cvOrigRateGet = desc.get;
            Object.defineProperty(HTMLMediaElement.prototype, "playbackRate", {
              configurable: true,
              enumerable: true,
              get() {
                return window.__cvOrigRateGet.call(this);
              },
              set(val) {
                if (this.__cvSetting) return window.__cvOrigRateSet.call(this, val);
                const tr = window.__cvRate;
                if (typeof tr === "number" && Math.abs(val - tr) > 0.01) {
                  return; // Neutralize automatic player reset towards 1.0
                }
                return window.__cvOrigRateSet.call(this, val);
              }
            });
          }
        } catch (_) {}

        try {
          if (!window.__cvPitchPatched) {
            window.__cvPitchPatched = true;
            Object.defineProperty(HTMLMediaElement.prototype, "preservesPitch", {
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

      // 2. Recursive search in Document, Iframe, and Shadow DOM
      function findAllMedia(root) {
        let list = [];
        if (!root) return list;
        try {
          const media = root.querySelectorAll("video, audio");
          for (let i = 0; i < media.length; i++) list.push(media[i]);
        } catch (_) {}
        try {
          const frames = root.querySelectorAll("iframe, frame");
          for (let i = 0; i < frames.length; i++) {
            try {
              const doc = frames[i].contentDocument || frames[i].contentWindow?.document;
              if (doc) list = list.concat(findAllMedia(doc));
            } catch (_) {}
          }
        } catch (_) {}
        try {
          const all = root.querySelectorAll("*");
          for (let i = 0; i < all.length; i++) {
            if (all[i].shadowRoot) list = list.concat(findAllMedia(all[i].shadowRoot));
          }
        } catch (_) {}
        return list;
      }

      window.__cvFindAllMedia = findAllMedia;

      window.__cvSetSafePlaybackRate = function(rate) {
        if (typeof rate !== "number" || isNaN(rate) || rate <= 0) return;
        window.__cvRate = rate;

        const media = findAllMedia(document);
        for (let i = 0; i < media.length; i++) {
          const el = media[i];
          applySpeed(el, rate);
          if (!el.__cvRateHooked) {
            el.__cvRateHooked = true;
            let timer = null;
            el.addEventListener("ratechange", (e) => {
              if (el.__cvSetting) return;
              const tr = window.__cvRate;
              if (typeof tr === "number" && Math.abs(el.playbackRate - tr) > 0.01) {
                if (!location.hostname.includes("youtube.com")) {
                  e.stopImmediatePropagation();
                }
                if (!timer) {
                  timer = setTimeout(() => {
                    timer = null;
                    applySpeed(el, window.__cvRate);
                  }, 300);
                }
              }
            }, true);
          }
        }

        try {
          const yt = document.getElementById("movie_player") || document.querySelector(".html5-video-player");
          if (yt && typeof yt.setPlaybackRate === "function") {
            if (rate <= 2.0) {
              if (typeof yt.getPlaybackRate === "function") {
                if (Math.abs(yt.getPlaybackRate() - rate) > 0.01) yt.setPlaybackRate(rate);
              } else {
                yt.setPlaybackRate(rate);
              }
            }
          }
        } catch (_) {}
      };
    }();
  }
});
