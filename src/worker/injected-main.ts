import { injected } from "./injected";

const scope = globalThis as typeof globalThis & {
  linkHintsInjected?: () => void;
};
scope.linkHintsInjected?.();
scope.linkHintsInjected = injected();
