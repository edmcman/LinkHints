const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const baseUrl = "https://edmcman.github.io/LinkHints";

/** @param {string} runNumber */
function version(runNumber) {
  if (!/^[1-9]\d*$/.test(runNumber)) {
    throw new Error("Invalid run number");
  }
  const run = Number(runNumber);
  if (!Number.isSafeInteger(run) || run > 65535 * 65536 + 65535) {
    throw new Error("Run number exceeds Chrome version range");
  }
  return `2.${Math.floor(run / 65536)}.${run % 65536}`;
}

/** @param {string} key */
function extensionId(key) {
  const publicKey = crypto.createPublicKey(key).export({
    type: "spki",
    format: "der",
  });
  return [
    ...crypto
      .createHash("sha256")
      .update(publicKey.toString("base64"), "base64")
      .digest()
      .subarray(0, 16),
  ]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join("");
}

/** @param {string} keyPath
 * @param {string} expectedId
 * @param {string} runNumber
 */
function publish(keyPath, expectedId, runNumber) {
  const id = extensionId(fs.readFileSync(keyPath, "utf8"));
  if (!/^[a-p]{32}$/.test(expectedId) || id !== expectedId) {
    throw new Error("Signing key does not match CHROME_EXTENSION_ID");
  }
  const manifest = JSON.parse(
    fs.readFileSync("compiled-chrome/manifest.json", "utf8")
  );
  const publishedVersion = version(runNumber);
  if (
    manifest.version !== publishedVersion ||
    manifest.update_url !== `${baseUrl}/update.xml`
  ) {
    throw new Error("Chrome manifest does not match the update feed");
  }
  const crx = fs
    .readdirSync("dist-chrome")
    .filter((file) => file.endsWith(".crx"));
  if (crx.length !== 1) {
    throw new Error("Expected exactly one CRX");
  }
  fs.copyFileSync(
    path.join("dist-chrome", crx[0]),
    "compiled-docs/link-hints.crx"
  );
  fs.writeFileSync(
    "compiled-docs/update.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">\n  <app appid="${id}"><updatecheck codebase="${baseUrl}/link-hints.crx" version="${publishedVersion}" /></app>\n</gupdate>\n`
  );
  fs.writeFileSync("compiled-docs/extension-id.txt", `${id}\n`);
}

if (require.main === module) {
  try {
    switch (process.argv[2]) {
      case "version":
        console.log(version(process.argv[3]));
        break;
      case "id":
        console.log(extensionId(fs.readFileSync(process.argv[3], "utf8")));
        break;
      case "publish":
        publish(process.argv[3], process.argv[4], process.argv[5]);
        break;
      default:
        throw new Error("Expected version, id, or publish");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = { version, extensionId, publish };
