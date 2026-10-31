import { readFile } from "fs/promises";
import { createServer } from "http";
import type { AddressInfo } from "net";
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

type HtmlServer = {
  url: (file: string, crossOrigin?: boolean) => string;
};

const htmlDir = path.resolve(__dirname, "..", "html");

const contentType = (file: string): string => {
  switch (path.extname(file)) {
    case ".xhtml":
      return "application/xhtml+xml";
    case ".svg":
      return "image/svg+xml";
    case ".css":
      return "text/css";
    case ".js":
      return "text/javascript";
    case ".json":
      return "application/json";
    default:
      return "text/html";
  }
};

const htmlTest = test.extend<{ html: HtmlServer }>({
  html: async ({ browser: _browser }, use) => {
    let port = 0;
    const serve = async (
      request: import("http").IncomingMessage,
      response: import("http").ServerResponse
    ): Promise<void> => {
      const pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://localhost").pathname
      );
      if (pathname === "/__regression_select.html") {
        response.setHeader("Content-Type", "text/html");
        response.end('<a href="#selected">Local target</a>');
        return;
      }
      const file = path.resolve(htmlDir, `.${pathname}`);
      if (!file.startsWith(`${htmlDir}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      try {
        response.setHeader("Content-Type", contentType(file));
        const body = await readFile(file);
        response.end(
          path.extname(file) === ".html"
            ? body.toString().replace(/localhost:5000/g, `localhost:${port}`)
            : body
        );
      } catch {
        response.writeHead(404).end();
      }
    };
    const server = createServer((request, response) => {
      void serve(request, response);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    ({ port } = server.address() as AddressInfo);
    try {
      await use({
        // localhost deliberately differs from 127.0.0.1 for frame-origin tests.
        url: (file, crossOrigin = false) =>
          `http://${crossOrigin ? "localhost" : "127.0.0.1"}:${port}/${file}`,
      });
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
  },
});

export { expect, htmlTest as test };

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
  await page.waitForTimeout(1_000);
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

export async function dismissHints(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      document.querySelector("#__LinkHintsWebExt")?.shadowRoot?.innerHTML ===
      undefined
  );
}

export async function hints(page: Page): Promise<Array<string>> {
  return page.locator("#__LinkHintsWebExt").evaluate((element) => {
    const root = element.shadowRoot;
    if (root === null) {
      throw new Error("Missing hint shadow root");
    }
    return Array.from(
      root.querySelectorAll(".hint"),
      (hint) => hint.textContent ?? ""
    );
  });
}

export async function selectHint(page: Page, hint: string): Promise<void> {
  await page.keyboard.type(hint);
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
