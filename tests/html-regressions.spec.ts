import type { Page } from "playwright";

import {
  activateHints,
  dismissHints,
  expect,
  hints,
  selectHint,
  test,
} from "./fixture";

const entries = {
  discovery: [
    "all-types/index.html",
    "area-decimals/index.html",
    "area-decimals/vertical.html",
    "contenteditable/index.html",
    "heavy-dom/index.html",
    "hint-position/index.html",
    "labels/index.html",
    "link-monster/index.html",
    "links-near-edge/corners.html",
    "links-near-edge/few.html",
    "links-near-edge/lots.html",
    "long-text/index.html",
    "media/index.html",
    "selectable/index.html",
    "styling/index.html",
    "tabindex/index.html",
  ],
  keyboard: [
    "accesskey/index.html",
    "combine-hrefs/index.html",
    "filter-by-text/index.html",
    "keydown/index.html",
    "list/index.html",
    "overlap/index.html",
    "prevent-default/index.html",
    "target/index.html",
    "history/index.html",
    "page-show-hide/index.html",
  ],
  mutations: [
    "changing-attributes/index.html",
    "moved-elements/index.html",
    "moved-root/index.html",
    "onRemoval/index.html",
    "removed-root/index.html",
    "replaced-elements/index.html",
    "shadow-dom/index.html",
    "slow/index.html",
    "slow-buttons/index.html",
    "untrusted-events/index.html",
  ],
  frames: [
    "frames/cross-domain/index.html",
    "frames/frameset/index.html",
    "frames/hidden/index.html",
    "frames/inserted/index.html",
    "frames/inserted-delay/index.html",
    "frames/monster/index.html",
    "frames/onclick/index.html",
    "frames/one/index.html",
    "frames/rogue/index.html",
    "frames/simple/index.html",
    "frames/size/index.html",
    "frames/without-src/index.html",
  ],
  specialized: [
    "top-layer/index.html",
    "tridactyl/index.html",
    "xhtml/index.xhtml",
  ],
} as const;

const allEntries = Object.values(entries).flat();

async function openAndHint(page: Page, url: string): Promise<Array<string>> {
  await page.goto(url);
  await page.bringToFront();
  await activateHints(page);
  const result = await hints(page);
  expect(result.length).toBeGreaterThan(0);
  return result;
}

test.describe("stable html regressions", () => {
  for (const [group, files] of Object.entries(entries)) {
    test.describe(group, () => {
      for (const file of files) {
        test(`${file} discovers visible targets`, async ({ context, html }) => {
          const page = await context.newPage();
          await openAndHint(page, html.url(file));
        });
      }
    });
  }

  test("registry excludes documented manual experiments", () => {
    expect(allEntries).not.toContainEqual(
      expect.stringContaining("experiments/")
    );
  });

  test("generated labels select a local link", async ({ context, html }) => {
    const page = await context.newPage();
    const labels = await openAndHint(
      page,
      html.url("__regression_select.html")
    );
    const before = page.url();
    await selectHint(page, labels[0] ?? "");
    await expect.poll(() => page.url()).not.toBe(before);
    expect(page.url()).toContain("#selected");
  });

  test("attribute changes refresh the target set", async ({
    context,
    html,
  }) => {
    const page = await context.newPage();
    await page.goto(html.url("changing-attributes/index.html"));
    await page.bringToFront();
    await activateHints(page);
    const before = (await hints(page)).length;
    await dismissHints(page);
    await page.getByRole("button", { name: "button role" }).click();
    await activateHints(page);
    expect((await hints(page)).length).toBeGreaterThan(before);
  });

  test("text filtering updates highlights when targets are removed", async ({
    context,
    html,
  }) => {
    const page = await context.newPage();
    const url = html.url("__regression_select.html");
    await page.route(url, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<p><a href="#one">123 One</a></p><p><a href="#two">123 Two</a></p><p><a href="#other">Other</a></p>',
      })
    );
    await openAndHint(page, url);
    await page.keyboard.type("123");
    const visible = page.locator(
      "#__LinkHintsWebExt .hint:not(.shruggie):not(.hidden)"
    );
    const highlights = page.locator("#__LinkHintsWebExt .matchedText");
    await expect(visible).toHaveCount(2);
    await expect(highlights).toHaveCount(2);
    await page.evaluate(() => {
      document.querySelector("a")?.remove();
    });
    await expect(visible).toHaveCount(1);
    await expect(highlights).toHaveCount(1);
    for (let index = 0; index < 3; index += 1) {
      await page.keyboard.press("Backspace");
    }
    await expect(visible).toHaveCount(2);
    await expect(highlights).toHaveCount(0);
  });

  test("inserted frames are discovered after their lifecycle update", async ({
    context,
    html,
  }) => {
    const page = await context.newPage();
    await page.goto(html.url("frames/inserted-delay/index.html"));
    await page.bringToFront();
    await activateHints(page);
    await expect(page.locator("iframe")).toHaveCount(1);
    await dismissHints(page);
    await activateHints(page);
    expect((await hints(page)).length).toBeGreaterThan(1);
  });

  test("cross-origin frames remain a separate origin and contribute hints", async ({
    context,
    html,
  }) => {
    const page = await context.newPage();
    await page.goto(html.url("frames/cross-domain/index.html"));
    await expect(page.locator("iframe")).toHaveAttribute("src", /localhost:/);
    expect(new URL(page.url()).hostname).toBe("127.0.0.1");
    await page.bringToFront();
    await activateHints(page);
    expect((await hints(page)).length).toBeGreaterThan(0);
  });

  test("shadow DOM additions update hints", async ({ context, html }) => {
    const page = await context.newPage();
    await page.goto(html.url("shadow-dom/index.html"));
    await page.locator("#container").evaluate((container) => {
      const root = container.firstElementChild?.shadowRoot;
      const buttons =
        root === null || root === undefined
          ? []
          : Array.from(root.querySelectorAll("button"));
      buttons.find((button) => button.textContent === "Add link")?.click();
    });
    await page.bringToFront();
    await activateHints(page);
    expect((await hints(page)).length).toBeGreaterThan(1);
  });

  test("top-layer links become discoverable when their popover opens", async ({
    context,
    html,
  }) => {
    const page = await context.newPage();
    await page.goto(html.url("top-layer/index.html"));
    await page.getByRole("button", { name: "Open Popover 1" }).click();
    await page.bringToFront();
    await activateHints(page);
    expect((await hints(page)).length).toBeGreaterThan(1);
  });
});
