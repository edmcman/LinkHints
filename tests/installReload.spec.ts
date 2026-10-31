import { chromium, expect, test } from "@playwright/test";
import { createServer } from "http";
import type { AddressInfo } from "net";
import path from "path";

test("installs into existing tabs and recovers after extension reload", async ({
  browserName,
}) => {
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
    const browser = context.browser();
    if (browser === null) {
      throw new Error("Missing browser");
    }
    const session = await browser.newBrowserCDPSession();
    const { id } = await session.send("Extensions.loadUnpacked", {
      path: path.resolve(__dirname, "..", "compiled-chrome"),
    });
    const background = await context.newPage();
    await background.goto(`chrome-extension://${id}/popup.html`);
    await page.bringToFront();
    await expect
      .poll(async () =>
        background.evaluate(async () => {
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
          const [tab] = await api.chrome.tabs.query({
            active: true,
            currentWindow: true,
          });
          return tab === undefined
            ? undefined
            : (await api.chrome.storage.session.get(`tabState:${tab.id}`))[
                `tabState:${tab.id}`
              ];
        })
      )
      .toBeDefined();
    await page.keyboard.press("Alt+j");
    await expect(
      page.locator("#__LinkHintsWebExt .hint:not(.shruggie)")
    ).toHaveCount(1);
    await background
      .evaluate(() => {
        (
          globalThis as unknown as {
            chrome: { runtime: { reload: () => void } };
          }
        ).chrome.runtime.reload();
      })
      .catch(() => undefined);
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
