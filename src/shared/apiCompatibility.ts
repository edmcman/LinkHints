/**
 * Cross-browser API compatibility helpers.
 *
 * There is a ridiculous amount of typescript stuff here, but after the
 * transition most of it should be able to go.
 */

export type ActionApi = {
  setBadgeBackgroundColor: (details: { color: string }) => Promise<void>;
  setIcon: (details: {
    path: Record<string, string>;
    tabId?: number;
  }) => Promise<void>;
  setBadgeText: (details: { text: string; tabId?: number }) => Promise<void>;
  setTitle: (details: { title: string; tabId?: number }) => Promise<void>;
};

export function getActionApi(): ActionApi {
  // Narrow the browser type to avoid `any` and unsafe member access rules.
  const b = browser as unknown as {
    action?: ActionApi;
    browserAction?: ActionApi;
  };
  const api = b.action ?? b.browserAction;
  if (api === undefined) {
    throw new Error(
      "Missing extension action API: expected browser.action or browser.browserAction to be present"
    );
  }
  return api;
}

export function getScriptingApi(): unknown {
  type Holder = {
    browser?: { scripting?: unknown };
    chrome?: { scripting?: unknown };
  };
  const g = globalThis as unknown as Holder;
  const scripting = g.browser?.scripting ?? g.chrome?.scripting;
  if (scripting === undefined) {
    throw new Error(
      "scripting API not available (browser.scripting / chrome.scripting)"
    );
  }
  return scripting;
}

/**
 * Insert CSS into a tab in a way that works for both Manifest V2 and V3.
 *
 * Notes:
 * - In MV2 we call `browser.tabs.insertCSS(tabId, details)` which supports
 *   `cssOrigin` and `runAt` options. In MV3 the equivalent is
 *   `scripting.insertCSS({ target: { tabId }, css })`.
 * - This helper accepts the same shape used at the calling site in
 *   `BackgroundProgram` (either `code` or `files`, plus optional
 *   `cssOrigin`/`runAt`) and delegates to the appropriate API.
 */
export async function insertCSSInTab(
  tabId: number,
  details: {
    code?: string;
    files?: Array<string>;
    cssOrigin?: "author" | "user";
    runAt?: "document_end" | "document_idle" | "document_start";
  }
): Promise<void> {
  type TabsApi = {
    insertCSS?: (
      tabId: number,
      details: {
        code?: string;
        files?: Array<string>;
        cssOrigin?: "author" | "user";
        runAt?: "document_end" | "document_idle" | "document_start";
      }
    ) => Promise<void>;
  };

  // Use the legacy `tabs` API when present (Manifest V2 or non-scripting
  // environments). This preserves `cssOrigin` and `runAt` behavior.
  const tabsApi = (browser as { tabs?: TabsApi }).tabs;
  if (tabsApi?.insertCSS !== undefined) {
    await tabsApi.insertCSS(tabId, {
      code: details.code,
      files: details.files,
      cssOrigin: details.cssOrigin,
      runAt: details.runAt,
    });
    return;
  }

  // Otherwise use the MV3 `scripting` API (Chromium). Rename `code` -> `css`
  // which `scripting.insertCSS` expects and delegate to it.
  type Scripting = {
    insertCSS: (details: {
      target: { tabId: number };
      css?: string;
      files?: Array<string>;
      cssOrigin?: "author" | "user";
      runAt?: "document_end" | "document_idle" | "document_start";
    }) => Promise<void>;
  };

  const scripting = getScriptingApi() as Scripting;
  const { code, ...rest } = details;

  await scripting.insertCSS({
    target: { tabId },
    ...(code !== undefined ? { css: code } : {}),
    ...rest,
  });
}

/**
 * Execute a script in a tab compatible with both Manifest V2 and V3.
 *
 * - MV2 (`tabs.executeScript`) accepts `code` or `files`.
 * - MV3 (`scripting.executeScript`) accepts `files` or `func`. For the
 *   simple permission probe used in this repo (calling with an empty
 *   `code` string) we map `code` to a no-op `func` when using MV3.
 */
export async function executeScriptInTab(
  tabId: number,
  details: {
    code?: string;
    files?: Array<string>;
    runAt?: "document_end" | "document_idle" | "document_start";
  }
): Promise<void> {
  // Prefer legacy tabs API (MV2 / Firefox).
  const tabsApi = (
    browser as {
      tabs?: {
        executeScript?: (
          tabId: number,
          details: {
            code?: string;
            files?: Array<string>;
            runAt?: "document_end" | "document_idle" | "document_start";
          }
        ) => Promise<unknown>;
      };
    }
  ).tabs;

  if (tabsApi?.executeScript !== undefined) {
    await tabsApi.executeScript(tabId, {
      code: details.code,
      files: details.files,
      runAt: details.runAt,
    });
    return;
  }

  // Fallback to MV3 scripting API and map `code` -> `func` (no-op) when used.
  const scripting = getScriptingApi() as {
    executeScript: (details: {
      target: { tabId: number };
      files?: Array<string>;
      func?: () => unknown;
      world?: string;
    }) => Promise<unknown>;
  };

  await scripting.executeScript({
    target: { tabId },
    ...(details.files !== undefined ? { files: details.files } : {}),
    ...(details.code !== undefined ? { func: () => undefined } : {}),
    ...(details.runAt === "document_start" ? { world: "MAIN" } : {}),
  });
}

// Copied from: https://stackoverflow.com/a/77047611
export async function getChromiumVariant(): Promise<
  import("../shared/messages").ChromiumVariant
> {
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  return tabs[0]?.vivExtData !== undefined ? "vivaldi" : "chrome";
}

export type ManifestLike = {
  action?: { default_icon?: unknown };
  browser_action?: { default_icon?: unknown };
};

export function getActionDefaultIcons(
  manifest: ManifestLike
): Record<string, string> {
  // Support both Manifest V3 (`action`) and Manifest V2 (`browser_action`).
  const icons =
    manifest.action?.default_icon ?? manifest.browser_action?.default_icon;

  if (icons === undefined) {
    throw new Error(
      "Missing default_icon for extension action: expected manifest.action.default_icon or manifest.browser_action.default_icon"
    );
  }

  return icons as Record<string, string>;
}
