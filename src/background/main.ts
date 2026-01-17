import { fireAndForget, log } from "../shared/main";
import BackgroundProgram from "./Program";

export function main(): void {
  log("log", "Background: main.ts starting up...");

  const program = new BackgroundProgram();

  // Register critical listeners synchronously so messages sent immediately
  // on service-worker restart are not lost.
  program.addEarlyListeners();

  fireAndForget(program.start(), "main->BackgroundProgram#start");

  // Attach the instance to the background page's `window` for debugging. This
  // means one can type `program` in the console opened from `about:debugging` or
  // `chrome://extensions` to look at the current state of things.
  // This is for debugging only, and should never be accessed in the code.
  if (typeof window !== "undefined") {
    // Only works in MV2 background pages, not MV3 service workers.
    (window as Window & { program?: typeof program }).program = program;
  }
}
