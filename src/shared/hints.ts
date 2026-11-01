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

const pointFields = {
  x: number,
  y: number,
  align: stringUnion({ left: null, right: null }),
  debug: string,
};

export type Point = Pick<HintMeasurements, keyof typeof pointFields>;

export type HintMeasurements = ReturnType<typeof HintMeasurements>;
export const HintMeasurements = fieldsAuto({
  ...pointFields,
  maxX: number,
  weight: number,
});

export type VisibleElement = {
  element: HTMLElement;
  type: ElementType;
  measurements: HintMeasurements;
  hasClickListener: boolean;
};

const elementReportFields = {
  type: ElementType,
  index: number,
  hintMeasurements: HintMeasurements,
  url: optional(string),
  urlWithTarget: optional(string),
  text: string,
  textContent: boolean,
  textWeight: number,
  isTextInput: boolean,
  hasClickListener: boolean,
};

export type ElementReport = ReturnType<typeof ElementReport>;
export const ElementReport = fieldsAuto(elementReportFields);

const extendedElementReportFields = {
  ...elementReportFields,
  frame: fieldsAuto({ id: number, index: number }),
  hidden: boolean,
};

export type ExtendedElementReport = ReturnType<typeof ExtendedElementReport>;
export const ExtendedElementReport = fieldsAuto(extendedElementReportFields);

export type ElementWithHint = ReturnType<typeof ElementWithHint>;
export const ElementWithHint = fieldsAuto({
  ...extendedElementReportFields,
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
