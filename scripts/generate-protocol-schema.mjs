#!/usr/bin/env node

process.argv.push(
  "--typescript-output",
  "src/contracts/useqProtocolSchema.generated.ts",
);
await import("../src-useq/scripts/generate_protocol_schema.mjs");
