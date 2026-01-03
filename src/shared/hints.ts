import {
  array,
  boolean,
  fieldsAuto,
  multi,
  number,
  optional,
  string,
  stringUnion,
} from "tiny-decoders";

export type ElementType = ReturnType<typeof ElementType>;
export const ElementType = stringUnion({
  "clickable-event": null,
  clickable: null,
  "sometimes-clickable": null, // <label>, <details>, <summary>
  link: null,
  selectable: null,
  textarea: null,
});

export type ElementTypes = ReturnType<typeof ElementTypes>;
export const ElementTypes = multi({
  array: array(ElementType),
  string: stringUnion({
    selectable: null,
  }),
});

export type Point = {
  x: number;
  y: number;
  align: "left" | "right";
  debug: string;
};

export const PointDecoder = fieldsAuto({
  x: number,
  y: number,
  align: stringUnion({ left: null, right: null }),
  debug: string,
});

export type HintMeasurements = Point & {
  maxX: number;
  weight: number;
};

export const HintMeasurementsDecoder = fieldsAuto({
  x: number,
  y: number,
  align: stringUnion({ left: null, right: null }),
  debug: string,
  maxX: number,
  weight: number,
});

export type VisibleElement = {
  element: HTMLElement;
  type: ElementType;
  measurements: HintMeasurements;
  hasClickListener: boolean;
};

export type ElementReport = {
  type: ElementType;
  index: number;
  hintMeasurements: HintMeasurements;
  url: string | undefined;
  urlWithTarget: string | undefined;
  text: string;
  textContent: boolean;
  textWeight: number;
  isTextInput: boolean;
  hasClickListener: boolean;
};

export const ElementReportDecoder = fieldsAuto({
  type: ElementType,
  index: number,
  hintMeasurements: HintMeasurementsDecoder,
  url: optional(string),
  urlWithTarget: optional(string),
  text: string,
  textContent: boolean,
  textWeight: number,
  isTextInput: boolean,
  hasClickListener: boolean,
});

export type ExtendedElementReport = ElementReport & {
  frame: {
    id: number;
    index: number;
  };
  hidden: boolean;
};

export const ExtendedElementReportDecoder = fieldsAuto({
  type: ElementType,
  index: number,
  hintMeasurements: HintMeasurementsDecoder,
  url: optional(string),
  urlWithTarget: optional(string),
  text: string,
  textContent: boolean,
  textWeight: number,
  isTextInput: boolean,
  hasClickListener: boolean,
  frame: fieldsAuto({
    id: number,
    index: number,
  }),
  hidden: boolean,
});

export type ElementWithHint = ExtendedElementReport & {
  weight: number;
  hint: string;
};

export const ElementWithHintDecoder = fieldsAuto({
  type: ElementType,
  index: number,
  hintMeasurements: HintMeasurementsDecoder,
  url: optional(string),
  urlWithTarget: optional(string),
  text: string,
  textContent: boolean,
  textWeight: number,
  isTextInput: boolean,
  hasClickListener: boolean,
  frame: fieldsAuto({
    id: number,
    index: number,
  }),
  hidden: boolean,
  weight: number,
  hint: string,
});

export function elementKey(element: ElementWithHint): string {
  const { x, y, align } = element.hintMeasurements;
  return [x, y, align, element.hint].join("\n");
}

export type ElementRender = {
  hintMeasurements: HintMeasurements;
  hint: string;
  highlighted: boolean;
  invertedZIndex: number;
};

export type HintUpdate =
  | {
      type: "Hide";
      index: number;
      hidden: true;
    }
  | {
      type: "UpdateContent";
      index: number;
      order: number;
      matchedChars: string;
      restChars: string;
      highlighted: boolean;
      hidden: boolean;
    }
  | {
      type: "UpdatePosition";
      index: number;
      order: number;
      hint: string;
      hintMeasurements: HintMeasurements;
      highlighted: boolean;
      hidden: boolean;
    };
