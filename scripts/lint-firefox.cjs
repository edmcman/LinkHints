// @ts-nocheck
require("sucrase/register/ts");

const { resolve } = require("node:path");
const { createInstance } = require("addons-linter");

const allowedWarnings = new Set([
  "MISSING_DATA_COLLECTION_PERMISSIONS",
  "UNSAFE_VAR_ASSIGNMENT",
]);

async function lint() {
  const configPath = "../web-ext-config.mjs";
  const [{ default: config }, { default: multimatch }] = await Promise.all([
    import(configPath),
    import("multimatch"),
  ]);
  const { sourceDir, artifactsDir, ignoreFiles, lint = {} } = config;
  const baseIgnoredPatterns = [
    "**/*.xpi",
    "**/*.zip",
    "**/.*",
    "**/.*/**/*",
    "**/node_modules",
    "**/node_modules/**/*",
  ];
  const sourcePath = resolve(sourceDir);
  const ignoredPatterns = [...baseIgnoredPatterns, ...ignoreFiles]
    .map((file) =>
      file.startsWith("!")
        ? `!${resolve(sourcePath, file.slice(1))}`
        : resolve(sourcePath, file)
    )
    .concat(
      artifactsDir
        ? [resolve(artifactsDir), resolve(artifactsDir, "**", "*")]
        : []
    );
  const linter = createInstance({
    config: {
      _: [sourceDir],
      logLevel: "fatal",
      pretty: false,
      warningsAsErrors: false,
      metadata: false,
      output: "none",
      boring: true,
      selfHosted: false,
      shouldScanFile: (fileName) =>
        multimatch(resolve(sourcePath, fileName), ignoredPatterns).length === 0,
      minManifestVersion: 2,
      maxManifestVersion: 3,
      enableDataCollectionPermissions: true,
    },
    runAsBinary: false,
  });

  const { errors, warnings } = await linter.run();
  const rejectedWarnings = warnings.filter(
    ({ code }) => !allowedWarnings.has(code)
  );

  for (const warning of warnings) {
    const { code, file, line, message } = warning;
    const location = file ? `${file}${line ? `:${line}` : ""}: ` : "";
    const allowance = allowedWarnings.has(code) ? " (allowlisted)" : "";
    console.log(`${code}${allowance}: ${location}${message}`);
  }

  for (const error of errors) {
    const { code, file, line, message } = error;
    const location = file ? `${file}${line ? `:${line}` : ""}: ` : "";
    console.error(`${code}: ${location}${message}`);
  }

  if (errors.length || (lint.warningsAsErrors && rejectedWarnings.length)) {
    process.exitCode = 1;
  }
}

lint().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
