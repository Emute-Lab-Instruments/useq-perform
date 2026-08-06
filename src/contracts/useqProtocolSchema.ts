import {
  USEQ_JSON_PROTOCOL_SCHEMA,
  type UseqJsonRequestDefinition,
  type UseqJsonRequestType,
} from "./useqProtocolSchema.generated.ts";

export {
  USEQ_JSON_PROTOCOL_SCHEMA,
  type UseqJsonRequestDefinition,
  type UseqJsonRequestType,
};

export interface ProtocolValidationResult {
  readonly ok: boolean;
  readonly error?: string;
}

const REQUESTS_BY_TYPE = new Map<string, UseqJsonRequestDefinition>(
  USEQ_JSON_PROTOCOL_SCHEMA.requests.map((request) => [request.type, request]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesKind(value: unknown, kind: string): boolean {
  switch (kind) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "scalar":
      return (
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
      );
    default:
      return false;
  }
}

function validateFields(
  payload: Record<string, unknown>,
  label: string,
  fields: readonly { name: string; kind: string; required: boolean }[],
): ProtocolValidationResult {
  for (const field of fields) {
    if (!(field.name in payload)) {
      if (field.required) {
        return { ok: false, error: `${label} requires field '${field.name}'` };
      }
      continue;
    }
    if (!matchesKind(payload[field.name], field.kind)) {
      return {
        ok: false,
        error: `${label} field '${field.name}' must be ${field.kind}`,
      };
    }
  }
  return { ok: true };
}

export function getProtocolRequestDefinition(
  type: string,
): UseqJsonRequestDefinition | undefined {
  return REQUESTS_BY_TYPE.get(type);
}

export function validateProtocolRequest(
  payload: unknown,
): ProtocolValidationResult {
  if (!isRecord(payload)) return { ok: false, error: "request must be an object" };
  if (typeof payload.type !== "string") {
    return { ok: false, error: "missing string field 'type'" };
  }

  const definition = getProtocolRequestDefinition(payload.type);
  if (!definition) {
    return { ok: false, error: `unknown request type '${payload.type}'` };
  }
  if (
    definition.requestId === "required" &&
    typeof payload.requestId !== "string"
  ) {
    return {
      ok: false,
      error: `${definition.type} requires string field 'requestId'`,
    };
  }
  if ("requestId" in payload && typeof payload.requestId !== "string") {
    return {
      ok: false,
      error: `${definition.type} field 'requestId' must be string`,
    };
  }
  return validateFields(payload, definition.type, definition.fields);
}

export function assertProtocolRequest(payload: unknown): asserts payload is {
  type: UseqJsonRequestType;
  requestId?: string;
} & Record<string, unknown> {
  const result = validateProtocolRequest(payload);
  if (!result.ok) throw new TypeError(result.error);
}

export function validateProtocolResponseEnvelope(
  payload: unknown,
): ProtocolValidationResult {
  if (!isRecord(payload)) return { ok: false, error: "response must be an object" };
  const definition = USEQ_JSON_PROTOCOL_SCHEMA.responses.find(
    (response) => response.type === payload.type,
  );
  if (!definition) {
    return { ok: false, error: `unknown response type '${String(payload.type)}'` };
  }
  return validateFields(payload, definition.type, definition.fields);
}

export function validateProtocolUnsolicitedMessage(
  payload: unknown,
): ProtocolValidationResult {
  if (!isRecord(payload)) return { ok: false, error: "message must be an object" };
  const definition = USEQ_JSON_PROTOCOL_SCHEMA.unsolicited.find(
    (message) => message.type === payload.type,
  );
  if (!definition) {
    return { ok: false, error: `unknown unsolicited type '${String(payload.type)}'` };
  }
  if ("requestId" in payload) {
    return {
      ok: false,
      error: `${definition.type} must not contain field 'requestId'`,
    };
  }
  return validateFields(payload, definition.type, definition.fields);
}

export function currentHardwareRequestTypes(): UseqJsonRequestType[] {
  return USEQ_JSON_PROTOCOL_SCHEMA.requests
    .filter((request) => request.hardware !== "unsupported")
    .map((request) => request.type);
}

export function currentWasmRequestTypes(): UseqJsonRequestType[] {
  return USEQ_JSON_PROTOCOL_SCHEMA.requests
    .filter((request) => request.wasm === "supported")
    .map((request) => request.type);
}
