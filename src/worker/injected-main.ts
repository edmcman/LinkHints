import { CONTAINER_ID } from "../shared/main";
import { injected } from "./injected";

const scope = globalThis as typeof globalThis & {
  linkHintsInjected?: () => void;
  linkHintsExtensionAlive?: () => boolean;
};
scope.linkHintsInjected?.();
if (BROWSER === "firefox") {
  delete scope.linkHintsExtensionAlive;
}
const reset = injected();
let monitor: number | undefined;
scope.linkHintsInjected = () => {
  if (monitor !== undefined) {
    clearInterval(monitor);
  }
  reset();
};

if (BROWSER === "firefox") {
  let connected = false;
  monitor = window.setInterval(() => {
    try {
      if (scope.linkHintsExtensionAlive !== undefined) {
        connected = scope.linkHintsExtensionAlive();
      } else if (connected) {
        throw new Error("Extension context removed");
      }
    } catch {
      scope.linkHintsInjected?.();
      delete scope.linkHintsInjected;
      delete scope.linkHintsExtensionAlive;
      document.getElementById(CONTAINER_ID)?.remove();
    }
  }, 1000);
}
