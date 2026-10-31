import { fireAndForget, log } from "../shared/main";
import RendererProgram from "./Program";

log("log", "renderer main.ts starting");

const scope = globalThis as typeof globalThis & { linkHintsRenderer?: boolean };
if (scope.linkHintsRenderer !== true) {
  scope.linkHintsRenderer = true;
  const program = new RendererProgram();
  fireAndForget(program.start(), "main->RendererProgram#start");
}
