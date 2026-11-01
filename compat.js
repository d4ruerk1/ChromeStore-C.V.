// Browser API compatibility shim (Chrome MV3 + Firefox + Brave)
if (typeof globalThis.browser === 'undefined' && typeof globalThis.chrome !== 'undefined') {
  globalThis.browser = chrome;
}
