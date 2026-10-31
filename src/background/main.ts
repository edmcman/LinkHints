import { fireAndForget, log } from "../shared/main";
import BackgroundProgram from "./Program";

export function main(): void {
  log("log", "Background: main.ts starting up...");

  const program = new BackgroundProgram();

  // Register critical listeners synchronously so messages sent immediately
  // on service-worker restart are not lost.
  program.addEarlyListeners();

  fireAndForget(program.start(), "main->BackgroundProgram#start");

  (globalThis as typeof globalThis & { program?: typeof program }).program =
    program;
}
