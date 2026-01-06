// This is an awkward stub to load the polyfill in the background.
import browser from "webextension-polyfill";

import { log } from "../shared/main";

(globalThis as { browser?: unknown }).browser = browser;

async function bootstrap(): Promise<void> {
  try {
    const { main }: { main: () => void } = await import("./main");
    main();
  } catch (err) {
    log("error", "Failed to load background script:", err);
  }
}

void bootstrap();
