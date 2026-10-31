import { injected } from "./injected";

const scope = globalThis as typeof globalThis & { linkHintsInjected?: string };
if (scope.linkHintsInjected !== BUILD_ID) {
  scope.linkHintsInjected = BUILD_ID;
  injected();
}
