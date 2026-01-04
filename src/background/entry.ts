// Entrypoint for background service worker bundle.
// Ensure the polyfill is included in the bundle so the service worker has
// a stable `browser` API on platforms that need it.
import "webextension-polyfill/dist/browser-polyfill.min.js";
import "./main";
