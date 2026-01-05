import { MAX_Z_INDEX } from "../shared/css";
import { log, setStyles } from "../shared/main";
import { CONTAINER_ID } from "../shared/main";

// Don’t run in extension pages (options/popup).
if (window.location.protocol.endsWith("-extension:")) {
  // Nothing to do here.
} else {
  try {
    // Avoid creating multiple iframes.
    const previous = document.getElementById(CONTAINER_ID);
    if (previous === null) {
      const iframe = document.createElement("iframe");
      iframe.id = CONTAINER_ID;
      setStyles(iframe, {
        all: "initial",
        position: "fixed",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        "z-index": MAX_Z_INDEX.toString(),
        "pointer-events": "none",
        border: "none",
        background: "transparent",
      });
      // Load the renderer UI as an extension page so it runs in the
      // extension origin and can receive direct messages from the
      // background and accept `scripting.insertCSS`.
      iframe.src = browser.runtime.getURL("renderer/frame.html");
      (document.documentElement ?? document).append(iframe);
      log("log", "RendererHost: created iframe");
    }
  } catch (error) {
    log("error", "RendererHost: failed to create iframe", String(error));
  }
}
