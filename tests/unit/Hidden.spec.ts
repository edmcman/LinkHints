import * as path from "path";
import { pathToFileURL } from "url";

import { expect, test } from "../fixture";

test.fail("Hidden class is not hidden", async ({ page }) => {
  
  const fileUrl = pathToFileURL(
    path.join(process.cwd(), "tests", "unit", "hidden-class.html")
  ).toString();
  await page.goto(fileUrl);
  await page.waitForLoadState("load");

  // Ensure the element is visible and not hidden via opacity
  await expect(page.locator("div.hidden")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("div.hidden")).not.toHaveCSS("opacity", "0", {
    timeout: 1_000,
  });
});
