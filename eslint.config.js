const { FlatCompat } = require("@eslint/eslintrc");

const compat = new FlatCompat({ baseDirectory: __dirname });

module.exports = [
  {
    ignores: [
      "custom.config.*",
      "compiled",
      "compiled*",
      "compiled-docs",
      "playwright-report",
    ],
  },
  ...compat.config(require("./.eslintrc.js")),
  {
    files: ["**/*.es5.js"],
    languageOptions: { sourceType: "script" },
  },
  {
    files: ["tests/fixture.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
];
