import path from "path";
import type { BrowserContext } from "playwright";
import { createFixture } from "playwright-webextext";

const TUTORIAL_WAIT_MS = 1_000;

const tutorialUrl = "https://lydell.github.io/LinkHints/tutorial.html";

const extensionPath = path.resolve(__dirname, "..", "compiled");

const { test, expect } = createFixture(extensionPath);

test("detect injected elements", async ({
  context,
}: {
  context: BrowserContext;
}) => {
  // Wait for the tutorial page to load.
  await new Promise((r) => {
    setTimeout(r, TUTORIAL_WAIT_MS);
  });

  // Now manually open the tutorial page
  const page = await context.newPage();
  await page.goto(tutorialUrl);
  await page.waitForLoadState("load");

  console.log(
    "open tabs:",
    context.pages().map((p) => p.url())
  );
  expect(page.url()).toBe(tutorialUrl);

  // Press the keyboard shortcut to activate hints mode
  await page.keyboard.press("Alt+j");

  // Wait for the extension's renderer container to appear
  await page.waitForSelector("#__LinkHintsWebExt", { timeout: 5000 });
});
