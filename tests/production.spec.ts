import { createServer } from "http";
import type { AddressInfo } from "net";

import { expect, test } from "./fixture";

test("activates and follows a hint", async ({ context, browserName }) => {
  test.skip(browserName !== "chromium", "Uses Chromium service worker storage");
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end('<a href="#target">Target</a>');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const page = await context.newPage();
    const background =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    await page.goto(url);
    await page.bringToFront();
    const state = async (): Promise<
      | { hintsState?: { elementsWithHints?: Array<{ hint: string }> } }
      | undefined
    > =>
      background.evaluate(async (pageUrl) => {
        const api = globalThis as unknown as {
          chrome: {
            tabs: {
              query: (query: { url: string }) => Promise<Array<{ id: number }>>;
            };
            storage: {
              session: {
                get: (key: string) => Promise<
                  Record<
                    string,
                    {
                      hintsState?: {
                        elementsWithHints?: Array<{ hint: string }>;
                      };
                    }
                  >
                >;
              };
            };
          };
        };
        const [tab] = await api.chrome.tabs.query({ url: pageUrl });
        if (tab === undefined) {
          return undefined;
        }
        const key = `tabState:${tab.id}`;
        return (await api.chrome.storage.session.get(key))[key];
      }, url);
    await expect.poll(state).toBeDefined();
    await page.keyboard.press("Alt+j");
    let hint: string | undefined;
    await expect
      .poll(async () => {
        hint = (await state())?.hintsState?.elementsWithHints?.[0]?.hint;
        return hint;
      })
      .toBeDefined();
    if (hint === undefined) {
      throw new Error("No hint");
    }
    await page.keyboard.type(hint);
    await expect(page).toHaveURL(/#target$/);
  } finally {
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
