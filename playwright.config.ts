import type { PlaywrightTestConfig } from "@playwright/test";

const config: PlaywrightTestConfig = {
  testDir: "tests",
  timeout: 60_000,
  retries: 2,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
    },
  },
  reporter: "list",
  projects: [
    {
      name: "firefox",
      use: {
        browserName: "firefox",
        // extensions need to be loaded in headed mode
        headless: false,
      },
    },
  ],
};

export default config;
