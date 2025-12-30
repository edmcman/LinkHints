import type { PlaywrightTestConfig } from "@playwright/test";

const config: PlaywrightTestConfig = {
  testDir: "tests",
  timeout: 60_000,
  expect: {
    timeout: 20_000,
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
