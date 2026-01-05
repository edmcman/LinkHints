import { fireAndForget, log } from "../shared/main";
import RendererProgram from "./Program";

log("log", "renderer main.ts starting");

const program = new RendererProgram();
fireAndForget(program.start(), "main->RendererProgram#start");
