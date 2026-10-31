import { createServer } from "http";
import type { AddressInfo } from "net";

import {
  activateHints,
  attachConsoleLogs,
  expect,
  startConsoleCapture,
  test,
} from "./fixture";

test("detects a click listener attached before insertion", async ({
  context,
  browserName,
}) => {
  test.skip(browserName !== "firefox", "Exercises Firefox's main-world bridge");
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.setHeader("Content-Security-Policy", "script-src 'none'");
    response.end("<main></main>");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const page = await context.newPage();
    const logs = startConsoleCapture(page);
    await page.goto(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
    );
    await page.bringToFront();
    await page.waitForFunction(
      () =>
        typeof (
          window as typeof window & {
            linkHintsExtensionAlive?: () => boolean;
          }
        ).linkHintsExtensionAlive === "function"
    );
    await page.evaluate(() => {
      const element = document.createElement("div");
      element.textContent = "Clickable";
      element.addEventListener("click", () => {
        location.hash = "clicked";
      });
      document.querySelector("main")?.append(element);
    });
    await page.waitForTimeout(500);
    await activateHints(page);
    const hint = page.locator("#__LinkHintsWebExt .hint:not(.shruggie)");
    // This has failed in CI without reproducing locally: record the state that
    // distinguishes "main-world script never ran" from "listener not seen".
    await expect(hint)
      .toHaveCount(1)
      .catch(async (error: unknown) => {
        const diagnostics = await page.evaluate(() => {
          const scope = window as unknown as Record<string, unknown>;
          return {
            readyState: document.readyState,
            extensionAlive: typeof scope.linkHintsExtensionAlive,
            injectedLoaded: typeof scope.linkHintsInjected,
            addEventListenerName: (
              Reflect.getOwnPropertyDescriptor(
                EventTarget.prototype,
                "addEventListener"
              )?.value as { name?: string } | undefined
            )?.name,
            clickable: document.querySelector("main")?.innerHTML,
            containers: document.querySelectorAll("#__LinkHintsWebExt").length,
          };
        });
        console.log(
          "firefoxMainWorld diagnostics:",
          JSON.stringify(diagnostics, null, 2)
        );
        await attachConsoleLogs("console-logs-firefox-main-world", logs);
        throw error;
      });
    const text = await hint.textContent();
    if (text === null) {
      throw new Error("Missing hint");
    }
    await page.keyboard.type(text);
    await expect(page).toHaveURL(/#clicked$/);
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
