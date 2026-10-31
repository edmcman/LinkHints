import browser from "webextension-polyfill";

(globalThis as { browser?: unknown }).browser = browser;
