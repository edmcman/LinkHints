import path from "path";
import type { BrowserContext, Page } from "playwright";
import { createFixture } from "playwright-webextext";

if (process.env.BROWSER === undefined) {
  throw new Error(
    "BROWSER environment variable must be set when running Playwright tests (e.g., BROWSER=firefox or BROWSER=chrome)"
  );
}
const compiledDir = `compiled-${process.env.BROWSER}`;
const extensionPath = path.resolve(__dirname, "..", compiledDir);

const { test, expect } = createFixture(extensionPath);
export { expect, test };

// Helpers for console log capture
export function startConsoleCapture(page: Page): Array<string> {
  const logs: Array<string> = [];
  page.on("console", (msg) => logs.push(msg.text()));
  return logs;
}

export async function attachConsoleLogs(
  name: string,
  logs: Array<string>
): Promise<void> {
  await test.info().attach(name, {
    body: JSON.stringify(logs, null, 2),
    contentType: "application/json",
  });
}

import { expect as playwrightExpect } from "@playwright/test";

// Helper to activate hints
export async function activateHints(
  page: Page,
  keystroke: string = "Alt+j"
): Promise<void> {
  await page.waitForFunction(
    () =>
      document.querySelector("#__LinkHintsWebExt")?.shadowRoot?.innerHTML ===
      undefined
  );
  // UGH I want to get rid of this so bad.
  await page.waitForTimeout(200);
  console.log("Pressing keystroke to activate hints:", keystroke);
  await page.keyboard.press(keystroke);
  await page.waitForFunction(
    () =>
      document.querySelector("#__LinkHintsWebExt")?.shadowRoot?.innerHTML !==
      undefined
  );
  // UGH I want to get rid of this so bad.
  await page.waitForTimeout(200);
}

// Helper to snapshot hints
export async function snapshotHints(
  page: Page,
  snapshotName: string
): Promise<void> {
  const shadowHTML = await page.locator("#__LinkHintsWebExt").evaluate((el) => {
    if (el.shadowRoot === null) {
      throw new Error("Missing shadow DOM");
    }
    return el.shadowRoot.innerHTML;
  });
  playwrightExpect(shadowHTML).toMatchSnapshot(snapshotName);
  await playwrightExpect(page).toHaveScreenshot();
}

// Helper to perform step 3 actions
export async function performStep3(
  page: Page,
  context: BrowserContext,
  keystroke: string
): Promise<void> {
  // Wait for #step-3
  await page.waitForURL(/#step-3/);

  // Activate hints
  await activateHints(page, keystroke);

  // Snapshot
  await snapshotHints(
    page,
    `shadow-step3-${keystroke.replace(/[^a-zA-Z0-9]/g, "")}.html`
  );

  // Press 'o'
  await page.keyboard.press("e");

  // Check new tab
  let newPage: Page | undefined;
  await expect
    .poll(() => {
      const pages = context.pages();
      newPage = pages.find((p) => p.url().includes("example.com"));
      return newPage;
    })
    .toBeTruthy();
  await newPage?.close();
}
