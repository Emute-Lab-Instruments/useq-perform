import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getReferenceDataCandidateUrls,
  loadReferenceDataFromCandidates,
} from "./referenceDataLoader";

describe("ModuLispReferenceTab data loading", () => {
  beforeEach(() => {});

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("builds multiple candidate URLs for reference data", () => {
    const candidates = getReferenceDataCandidateUrls();
    expect(candidates.length).toBeGreaterThan(1);
    expect(
      candidates.some((url) => url.includes("modulisp_reference_data.json")),
    ).toBe(true);
  });

  it("falls back across candidates", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          name: "seq",
          description: "Sequence",
          aliases: ["sequence"],
          tags: ["control"],
          parameters: ["a", "b"],
          examples: ["(seq 1 2)"],
          introduced_in_version: "1.2.0",
        },
      ],
    } as Response);

    const data = await loadReferenceDataFromCandidates();

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(data.length).toBe(1);
    const entry = data[0] as { name?: string; parameters?: string[] };
    expect(entry.name).toBe("seq");
    expect(entry.parameters?.[0]).toBe("a");
  });
});
