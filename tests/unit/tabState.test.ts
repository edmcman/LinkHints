import { expect, test } from "@playwright/test";

Object.assign(globalThis, {
  META_SLUG: "link_hints",
  PROD: true,
  DEFAULT_LOG_LEVEL_CONFIG: "warn",
});

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
const { TabState } =
  require("../../src/background/tabState") as typeof import("../../src/background/tabState");
const { TimeTracker } =
  require("../../src/shared/perf") as typeof import("../../src/shared/perf");
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */

const report = {
  type: "link",
  index: 0,
  hintMeasurements: {
    x: 0,
    y: 0,
    align: "left",
    debug: "",
    maxX: 10,
    weight: 1,
  },
  text: "Link",
  textContent: true,
  textWeight: 1,
  isTextInput: false,
  hasClickListener: false,
  frame: { id: 0, index: 0 },
  hidden: false,
} as const;
const element = { ...report, weight: 1, hint: "a" };

const active = {
  mode: "Click",
  startTime: 0,
  time: {
    _durations: [["collect", 10]],
    _current: { label: "render", timestamp: 0 },
  },
  stats: [],
  highlighted: [{ sinceTimestamp: 0, element }],
} as const;

const states = {
  Idle: { type: "Idle", highlighted: active.highlighted },
  Collecting: {
    ...active,
    type: "Collecting",
    refreshing: false,
    pendingElements: {
      pendingFrames: { answering: 1, collecting: 1, lastStartWaitTimestamp: 0 },
      elements: [report],
    },
  },
  Hinting: {
    ...active,
    type: "Hinting",
    enteredChars: "",
    enteredText: "",
    elementsWithHints: [element],
    updateState: { type: "WaitingForResponse", lastUpdateStartTimestamp: 0 },
    peeking: false,
  },
};

function saved(hintsState: unknown): Record<string, unknown> {
  return {
    hintsState,
    keyboardMode: { type: "FromHintsState" },
    perf: [],
    isOptionsPage: false,
    isPinned: false,
  };
}

for (const [name, hints] of Object.entries(states)) {
  test(`restores serialized ${name} state and its time tracker`, () => {
    const serial = JSON.parse(JSON.stringify(saved(hints))) as unknown;
    const state = TabState(serial);
    expect(JSON.parse(JSON.stringify(state))).toEqual(serial);
    if (state.hintsState.type !== "Idle") {
      expect(state.hintsState.time).toBeInstanceOf(TimeTracker);
      state.hintsState.time.stop();
      expect(state.hintsState.time.export().map(([label]) => label)).toEqual([
        "collect",
        "render",
      ]);
    }
  });
}

const invalidHints = [
  { type: "Idle", highlighted: [null] },
  { type: "Idle", highlighted: [{ sinceTimestamp: 0, element: {} }] },
  { ...states.Collecting, pendingElements: undefined },
  { ...states.Collecting, mode: "Unknown" },
  { ...states.Collecting, time: { _durations: [], _current: {} } },
  { ...states.Hinting, elementsWithHints: [{}] },
  {
    ...states.Hinting,
    updateState: { type: "Unknown", lastUpdateStartTimestamp: 0 },
  },
];

test("rejects incomplete nested hint states", () => {
  for (const hints of invalidHints) {
    expect(() => TabState(saved(hints))).toThrow();
  }
});

test("validates keyboard modes and renderer frame IDs", () => {
  for (const keyboardMode of [
    { type: "Capture" },
    { type: "FromHintsState" },
    { type: "PreventOverTyping", sinceTimestamp: 0 },
  ]) {
    expect(
      TabState({ ...saved(states.Idle), keyboardMode }).keyboardMode
    ).toEqual(keyboardMode);
  }
  for (const keyboardMode of [
    { type: "Unknown" },
    { type: "PreventOverTyping" },
  ]) {
    expect(() => TabState({ ...saved(states.Idle), keyboardMode })).toThrow();
  }
  expect(() =>
    TabState({ ...saved(states.Idle), rendererFrameId: "0" })
  ).toThrow();
  const state = TabState(saved(states.Idle));
  expect(state.rendererFrameId).toBeUndefined();
});
