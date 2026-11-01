import { expect, test } from "@playwright/test";

Object.assign(globalThis, { META_SLUG: "link_hints", PROD: true });

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
const { deserializeShortcut } =
  require("../../src/shared/keyboard") as typeof import("../../src/shared/keyboard");
const { diffOptions } =
  require("../../src/shared/options") as typeof import("../../src/shared/options");
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */

test("shortcut parsing preserves separator keys and ignores empty modifiers", () => {
  expect(deserializeShortcut("alt--")).toEqual({
    key: "-",
    alt: true,
    cmd: false,
    ctrl: false,
    shift: false,
  });
  expect(deserializeShortcut("alt--x")).toEqual(deserializeShortcut("alt-x"));
  expect(deserializeShortcut("key-x").key).toBe("x");
  expect(deserializeShortcut("unknown-x")).toHaveProperty("unknown", true);
  expect(deserializeShortcut("").key).toBe("-");
});

test("option diffs preserve deletions and remove redundant overrides", () => {
  expect(
    diffOptions(
      { "normal.alt-j": "EnterHintsMode_Click", autoActivate: true },
      { "normal.alt-k": "EnterHintsMode_BackgroundTab", autoActivate: true },
      {
        "normal.alt-j": "EnterHintsMode_Click",
        "normal.alt-l": "Select",
        autoActivate: false,
      }
    )
  ).toEqual({
    keysToRemove: ["autoActivate", "normal.alt-l"],
    optionsToSet: {
      "normal.alt-j": null,
      "normal.alt-k": "EnterHintsMode_BackgroundTab",
    },
  });
  expect(diffOptions({ shortcut: "Click" }, {}, { shortcut: null })).toEqual({
    keysToRemove: [],
    optionsToSet: {},
  });
});

test("option diffs distinguish missing keys from explicit undefined", () => {
  expect(diffOptions({ value: undefined }, {}, {})).toEqual({
    keysToRemove: [],
    optionsToSet: { value: null },
  });
  expect(diffOptions({}, { value: undefined }, { value: "old" })).toEqual({
    keysToRemove: [],
    optionsToSet: { value: undefined },
  });
  expect(
    diffOptions({ value: undefined }, { value: undefined }, { value: "old" })
  ).toEqual({
    keysToRemove: ["value"],
    optionsToSet: {},
  });
});
