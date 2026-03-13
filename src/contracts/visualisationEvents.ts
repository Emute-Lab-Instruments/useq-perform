export const VISUALISATION_SESSION_EVENT = "useq-visualisation-changed";
export const SERIAL_VIS_PALETTE_CHANGED_EVENT = "useq-serialvis-palette-changed";
export const SERIAL_VIS_AUTO_OPEN_EVENT = "useq-serialvis-auto-open";

export interface VisualisationSampleDetail {
  time: number;
  value: number;
}

export interface VisualisationExpressionDetail {
  exprType: string;
  expressionText: string;
  samples: VisualisationSampleDetail[];
  color: string | null;
}

export interface VisualisationSettingsDetail {
  windowDuration: number;
  sampleCount: number;
  lineWidth: number;
  futureDashed: boolean;
  futureMaskOpacity: number;
  futureMaskWidth: number;
  circularOffset: number;
  futureLeadSeconds: number;
  digitalLaneGap: number;
}

export interface VisualisationSessionDetail {
  kind?: string;
  currentTimeSeconds?: number;
  displayTimeSeconds?: number;
  settings?: Partial<VisualisationSettingsDetail>;
  expressions?: Record<string, Partial<VisualisationExpressionDetail>>;
  bar?: number;
}

export interface SerialVisPaletteChangedDetail {
  palette?: string[];
}

export type SerialVisAutoOpenDetail = undefined;

export interface VisualisationEventDetailMap {
  [VISUALISATION_SESSION_EVENT]: VisualisationSessionDetail;
  [SERIAL_VIS_PALETTE_CHANGED_EVENT]: SerialVisPaletteChangedDetail;
  [SERIAL_VIS_AUTO_OPEN_EVENT]: SerialVisAutoOpenDetail;
}

export type VisualisationEventName = keyof VisualisationEventDetailMap;

export const VISUALISATION_EVENT_NAMES = Object.freeze([
  VISUALISATION_SESSION_EVENT,
  SERIAL_VIS_PALETTE_CHANGED_EVENT,
  SERIAL_VIS_AUTO_OPEN_EVENT,
] as const satisfies readonly VisualisationEventName[]);

function getCustomEventConstructor():
  | (new <T>(type: string, eventInitDict?: CustomEventInit<T>) => CustomEvent<T>)
  | null {
  if (typeof window !== "undefined" && typeof window.CustomEvent === "function") {
    return window.CustomEvent;
  }

  if (typeof globalThis.CustomEvent === "function") {
    return globalThis.CustomEvent;
  }

  return null;
}

export function assertVisualisationEventContract(): void {
  if (new Set(VISUALISATION_EVENT_NAMES).size !== VISUALISATION_EVENT_NAMES.length) {
    throw new Error("Visualisation event names must be unique");
  }
}

export function dispatchVisualisationEvent<Name extends VisualisationEventName>(
  name: Name,
  detail: VisualisationEventDetailMap[Name],
  target:
    | Pick<Window, "dispatchEvent">
    | undefined = typeof window !== "undefined" ? window : undefined
): boolean {
  if (!target || typeof target.dispatchEvent !== "function") {
    return false;
  }

  const EventCtor = getCustomEventConstructor();
  if (!EventCtor) {
    return false;
  }

  return target.dispatchEvent(new EventCtor(name, { detail }));
}

export function readVisualisationEventDetail<Name extends VisualisationEventName>(
  event: Event
): VisualisationEventDetailMap[Name] {
  return (event as CustomEvent<VisualisationEventDetailMap[Name]>).detail;
}

export function addVisualisationEventListener<Name extends VisualisationEventName>(
  name: Name,
  listener: (
    detail: VisualisationEventDetailMap[Name],
    event: CustomEvent<VisualisationEventDetailMap[Name]>
  ) => void,
  target:
    | Pick<Window, "addEventListener" | "removeEventListener">
    | undefined = typeof window !== "undefined" ? window : undefined
): () => void {
  if (!target) {
    return () => undefined;
  }

  const wrapped = (event: Event): void => {
    listener(
      readVisualisationEventDetail<Name>(event),
      event as CustomEvent<VisualisationEventDetailMap[Name]>
    );
  };

  target.addEventListener(name, wrapped as EventListener);
  return () => {
    target.removeEventListener(name, wrapped as EventListener);
  };
}

assertVisualisationEventContract();
