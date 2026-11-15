const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { extensionId, publish, version } = require("./publish-chrome.cjs");

test("versions increase across component boundaries and reject invalid inputs", () => {
  assert.equal(version("1"), "2.0.1");
  assert.equal(version("65535"), "2.0.65535");
  assert.equal(version("65536"), "2.1.0");
  for (const input of ["0", "-1", "1.5", "4294967296", ""]) {
    assert.throws(() => version(input));
  }
});

test("feed uses the key ID and packaged version, and rejects mismatches", () => {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "linkhints-publish-"));
  try {
    process.chdir(dir);
    fs.mkdirSync("compiled-chrome");
    fs.mkdirSync("compiled-docs");
    fs.mkdirSync("dist-chrome");
    const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const key = String(privateKey.export({ type: "pkcs8", format: "pem" }));
    fs.writeFileSync("key.pem", key);
    const id = extensionId(key);
    fs.writeFileSync(
      "compiled-chrome/manifest.json",
      JSON.stringify({
        version: version("65536"),
        update_url: "https://edmcman.github.io/LinkHints/update.xml",
      })
    );
    fs.writeFileSync("dist-chrome/test.crx", "test");
    assert.throws(() => publish("missing.pem", id, "65536"));
    assert.throws(() => publish("key.pem", "a".repeat(32), "65536"));
    assert.throws(() => publish("key.pem", id, "65537"));
    publish("key.pem", id, "65536");
    const xml = fs.readFileSync("compiled-docs/update.xml", "utf8");
    assert.match(xml, new RegExp(`appid="${id}"`));
    assert.match(xml, /version="2\.1\.0"/);
    assert.match(
      xml,
      /https:\/\/edmcman\.github\.io\/LinkHints\/link-hints\.crx/
    );
    assert.equal(
      fs.readFileSync("compiled-docs/extension-id.txt", "utf8"),
      `${id}\n`
    );
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
