import { fireAndForget } from "../shared/main";
import WorkerProgram from "./Program";

// In Firefox, `match_about_blank: true` triggers even if you visit
// `about:blank` directly, not just blank iframes and `window.open()`.
// It makes no sense doing anything in a completely blank page.
const scope = globalThis as typeof globalThis & { linkHintsWorker?: boolean };
if (
  scope.linkHintsWorker !== true &&
  !(window.location.href === "about:blank" && window.top === window)
) {
  scope.linkHintsWorker = true;
  const program = new WorkerProgram();
  fireAndForget(program.start(), "main->WorkerProgram#start");
}
