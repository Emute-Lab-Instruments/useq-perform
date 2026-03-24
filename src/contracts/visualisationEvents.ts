// src/contracts/visualisationEvents.ts
//
// Type definitions for visualisation event payloads.
//
// The old CustomEvent dispatch/listen infrastructure has been removed.
// Use the typed channels in ./visualisationChannels.ts instead.

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
  exprType?: string;
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
