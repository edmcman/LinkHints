import * as path from "path";
import { pathToFileURL } from "url";

import { expect, test } from "../fixture";

test("Hidden class is not hidden", async ({ page }) => {
  const fileUrl = pathToFileURL(
    path.join(process.cwd(), "tests", "unit", "hidden-class.html")
  ).toString();
  await page.goto(fileUrl);
  await page.waitForLoadState("load");

  // FIXME: The extension currently defines a global `.hidden { opacity: 0 }` rule that
  // collides with page styles. Fix the extension CSS (scope or rename class) and
  // remove this workaround.
  // Ensure the element is visible and not hidden via opacity
  await expect(page.locator("div.hidden")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("div.hidden")).not.toHaveCSS("opacity", "0", {
    timeout: 1_000,
  });
});
