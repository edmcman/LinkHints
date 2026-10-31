import config from "../project.config";

type IconsList = Array<[number, string]>;
type Icons = { svg: IconsList; png: IconsList };
type IconSizes = Record<string, string>;

export default (): string =>
  toJSON({
    manifest_version: 3,
    version: config.meta.version,
    name: config.meta.name,
    author: config.meta.author,
    description: config.meta.description,
    homepage_url: config.meta.homepage,
    minimum_chrome_version: config.browser === "chrome" ? "148" : undefined,
    browser_specific_settings: getBrowserSpecificSettings(config.browser),
    icons: getIcons(config.icons, config.browser),
    permissions: ["storage", "scripting"],
    host_permissions: [
      // Host patterns moved to host_permissions for MV3.
      "<all_urls>",
    ],
    action: {
      default_popup: config.popupHtml,
      default_icon: getIcons(config.icons, config.browser),
    },
    options_ui: {
      page: config.optionsHtml,
      open_in_tab: true,
    },
    background: config.serviceWorkerEnabled
      ? { service_worker: config.background.output }
      : { scripts: [config.background.output] },
    // MV3 requires an explicit content security policy for extension pages.
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
    content_scripts: [
      config.injectedAsContentScript
        ? {
            matches: ["<all_urls>"],
            all_frames: true,
            match_about_blank: true,
            run_at: "document_start",
            world: "MAIN",
            js: [config.injected.output].filter(
              (script) => script !== undefined
            ),
          }
        : undefined,
      {
        matches: ["<all_urls>"],
        all_frames: true,
        match_about_blank: true,
        run_at: "document_start",
        world: "ISOLATED",
        js: [config.worker.output],
      },

      {
        matches: ["<all_urls>"],
        run_at: "document_start",
        js: [config.renderer.output],
      },
    ].filter((s) => s !== undefined),
  });

function toJSON(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, undefined, 2);
}

function getBrowserSpecificSettings(browser: Browser | undefined): unknown {
  switch (browser) {
    case "chrome":
      return undefined;

    case "firefox":
    case undefined:
      return {
        gecko: {
          id: config.meta.geckoId,
          strict_min_version: "128.0",
        },
      };
  }
}

function makeSizes(icons: Array<[number, string]>): IconSizes {
  return Object.fromEntries(
    icons.map(([size, path]) => [size.toString(), path])
  );
}

function getIcons(icons: Icons, browser: Browser | undefined): IconSizes {
  switch (browser) {
    case "firefox":
      return makeSizes(icons.svg);

    case "chrome":
    case undefined:
      return makeSizes(icons.png);
  }
}
