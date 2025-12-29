import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(__dirname, "..");
const logDir = path.join(rootDir, "test-results");
const logFile = path.join(logDir, "firefox-console.log");
const manifestPath = path.join(rootDir, "compiled", "manifest.json");

const ensureDir = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true });
};

const tee = (chunk: Buffer, fileStream: fs.WriteStream): void => {
  process.stdout.write(chunk as unknown as Uint8Array);
  fileStream.write(chunk);
};

const run = async (
  cmd: string,
  args: string[],
  fileStream: fs.WriteStream,
): Promise<void> =>
  await new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: rootDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout.on("data", (chunk: Buffer) => tee(chunk, fileStream));
    proc.stderr.on("data", (chunk: Buffer) => tee(chunk, fileStream));

    proc.on("close", (code, signal) => {
      if (signal !== null) {
        reject(new Error(`${cmd} exited due to signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${cmd} exited with code ${code}`));
        return;
      }
      resolve(undefined);
    });

    proc.on("error", reject);
  });

const main = async (): Promise<void> => {
  ensureDir(logDir);

  const fileStream = fs.createWriteStream(logFile, { flags: "w" });
  fileStream.write(
    `# Captured via: npm run firefox:console\n# Started: ${new Date().toISOString()}\n\n`,
  );

  if (!fs.existsSync(manifestPath)) {
    fileStream.write(
      `# Note: ${manifestPath} missing; running npm run compile\n\n`,
    );
    await run("npm", ["run", "-s", "compile"], fileStream);
  }

  try {
    await run(
      "npm",
      [
        "run",
        "-s",
        "web-ext",
        "--",
        "run",
        "--verbose",
        "--browser-console",
        "--no-input",
        "--pref=devtools.console.stdout.chrome=true",
        "--pref=devtools.console.stdout.content=true",
      ],
      fileStream,
    );
    fileStream.end("\n# Exit code: 0\n");
  } catch (error) {
    fileStream.end(`\n# Error: ${String(error)}\n`);
    throw error;
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
