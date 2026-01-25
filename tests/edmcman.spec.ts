import type { BrowserContext } from "playwright";

import {
  attachConsoleLogs,
  expect,
  startConsoleCapture,
  test,
} from "./fixture";

test("edmcman menu becomes visible", async ({
  context,
}: {
  context: BrowserContext;
}) => {
  // Capture console logs for debugging if needed
  const page = await context.newPage();
  const logs = startConsoleCapture(page);

  try {
    await page.goto("https://edmcman.github.io");
    await page.waitForLoadState("load");
    console.log("edmcman page loaded");

    // Wait up to 15s for the menu to become visible
    await expect(page.locator("div.right.menu")).toBeVisible({
      timeout: 15_000,
    });
    console.log("Verified div.right.menu is visible");

    await attachConsoleLogs("console-logs-edmcman-menu", logs);
  } catch (e) {
    await attachConsoleLogs("console-logs-edmcman-menu", logs);
    throw e;
  }
});
