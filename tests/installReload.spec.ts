import { chromium, expect, test } from "@playwright/test";
import { createServer } from "http";
import type { AddressInfo } from "net";
import path from "path";

const extensionPath = path.resolve(__dirname, "..", "compiled-chrome");

(
  [
    "uninstall",
    "disable",
    "uninstall after worker stops",
    "disable after worker stops",
  ] as const
).forEach((action) => {
  test(`cleans up after extension ${action}`, async ({ browserName }) => {
    test.skip(
      browserName !== "chromium",
      "Uses Chromium's extension debugging protocol"
    );
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end('<a href="#target">Target</a>');
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const context = await chromium.launchPersistentContext("", {
      headless: false,
      args: ["--enable-unsafe-extension-debugging"],
      ignoreDefaultArgs: ["--disable-extensions"],
    });
    try {
      const page = await context.newPage();
      await page.goto(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
      );
      await page.evaluate(() => {
        (
          window as Window & { originalAddEventListener?: unknown }
        ).originalAddEventListener = Reflect.get(
          EventTarget.prototype,
          "addEventListener"
        );
      });
      const browser = context.browser();
      if (browser === null) {
        throw new Error("Missing browser");
      }
      const session = await browser.newBrowserCDPSession();
      const { id } = await session.send("Extensions.loadUnpacked", {
        path: extensionPath,
      });
      // Chrome disables unpacked extensions on reload unless developer mode is on.
      const extensionsPage = await context.newPage();
      await extensionsPage.goto("chrome://extensions/");
      await extensionsPage.evaluate(() =>
        (
          globalThis as unknown as {
            chrome: {
              developerPrivate: {
                updateProfileConfiguration: (config: object) => Promise<void>;
              };
            };
          }
        ).chrome.developerPrivate.updateProfileConfiguration({
          inDeveloperMode: true,
        })
      );
      await extensionsPage.close();
      const background = await context.newPage();
      await background.goto(`chrome-extension://${id}/popup.html`);
      await page.bringToFront();
      await expect
        .poll(async () =>
          background.evaluate(async (pageUrl) => {
            const api = globalThis as unknown as {
              chrome: {
                tabs: {
                  query: (query: object) => Promise<Array<{ id: number }>>;
                };
                storage: {
                  session: {
                    get: (key: string) => Promise<Record<string, unknown>>;
                  };
                };
              };
            };
            const [tab] = await api.chrome.tabs.query({ url: pageUrl });
            return tab === undefined
              ? undefined
              : (await api.chrome.storage.session.get(`tabState:${tab.id}`))[
                  `tabState:${tab.id}`
                ];
          }, page.url())
        )
        .toBeDefined();
      await page.keyboard.press("Alt+j");
      await expect(
        page.locator("#__LinkHintsWebExt .hint:not(.shruggie)")
      ).toHaveCount(1);
      const workerReady = page.waitForEvent("console", {
        predicate: (message) =>
          message.text().includes("WorkerProgram#onMessage StateSync"),
      });
      const rendererReady = page.waitForEvent("console", {
        predicate: (message) =>
          message.text().includes("RendererProgram#onMessage StateSync"),
      });
      await background
        .evaluate(() => {
          (
            globalThis as unknown as {
              chrome: { runtime: { reload: () => void } };
            }
          ).chrome.runtime.reload();
        })
        .catch(() => undefined);
      await Promise.all([workerReady, rendererReady]);
      await expect(page.locator("#__LinkHintsWebExt")).toHaveCount(0);
      await page.keyboard.press("Alt+j");
      await expect(
        page.locator("#__LinkHintsWebExt .hint:not(.shruggie)")
      ).toHaveCount(1);
      await page.keyboard.press("Escape");
      await page.evaluate(() => {
        const element = document.createElement("div");
        element.textContent = "Clickable";
        element.addEventListener("click", () => undefined);
        document.body.append(element);
      });
      await page.keyboard.press("Alt+j");
      await expect(
        page.locator("#__LinkHintsWebExt .hint:not(.shruggie)")
      ).toHaveCount(2);
      if (action.endsWith("after worker stops")) {
        await background.close();
        const pageSession = await context.newCDPSession(page);
        const { targetInfos } = await pageSession.send("Target.getTargets");
        const worker = targetInfos.find(
          ({ type, url }) =>
            type === "service_worker" &&
            url.startsWith(`chrome-extension://${id}/`)
        );
        if (worker === undefined) {
          throw new Error("Missing service worker");
        }
        await pageSession.send("Target.closeTarget", {
          targetId: worker.targetId,
        });
        await pageSession.detach();
        await page.waitForTimeout(2500);
      }
      if (action.startsWith("uninstall")) {
        await session.send("Extensions.uninstall", { id });
      } else {
        const extensions = await context.newPage();
        await extensions.goto("chrome://extensions/");
        await extensions.locator(`extensions-item#${id} #enableToggle`).click();
      }
      await expect(page.locator("#__LinkHintsWebExt")).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as Window & { originalAddEventListener?: unknown })
                .originalAddEventListener ===
              Reflect.get(EventTarget.prototype, "addEventListener")
          )
        )
        .toBe(true);
      await page.evaluate(() => {
        window.addEventListener("keydown", (event) => {
          if (event.key === "j" && event.altKey) {
            document.documentElement.dataset.shortcutReceived = "yes";
          }
        });
      });
      await page.bringToFront();
      await page.keyboard.press("Alt+j");
      await expect(page.locator("html")).toHaveAttribute(
        "data-shortcut-received",
        "yes"
      );
    } finally {
      await context.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      });
    }
  });
});
