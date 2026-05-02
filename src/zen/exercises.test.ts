import { describe, it, expect } from "vitest";
import {
  exercises,
  categories,
  getExercisesByCategory,
  getExercise,
  getNextInCategory,
  type CategoryId,
} from "./exercises";

describe("zen exercises DSL", () => {
  it("all exercises have cursor markers stripped from code", () => {
    for (const ex of exercises) {
      expect(ex.startCode).not.toContain("«");
      expect(ex.startCode).not.toContain("»");
      expect(ex.targetCode).not.toContain("«");
      expect(ex.targetCode).not.toContain("»");
    }
  });

  it("all exercises have non-empty cursor text", () => {
    for (const ex of exercises) {
      expect(ex.startCursorText.length).toBeGreaterThan(0);
      expect(ex.targetCursorText.length).toBeGreaterThan(0);
    }
  });

  it("cursor text appears in the code string", () => {
    for (const ex of exercises) {
      expect(ex.startCode).toContain(ex.startCursorText);
      expect(ex.targetCode).toContain(ex.targetCursorText);
    }
  });

  it("all exercise IDs are unique", () => {
    const ids = exercises.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all exercises reference a valid category", () => {
    const catIds = new Set(categories.map((c) => c.id));
    for (const ex of exercises) {
      expect(catIds.has(ex.category)).toBe(true);
    }
  });

  it("every category has at least one exercise", () => {
    for (const cat of categories) {
      const catExercises = getExercisesByCategory(cat.id);
      expect(catExercises.length).toBeGreaterThan(0);
    }
  });

  it("getExercise returns correct exercise by id", () => {
    const ex = getExercise("slurp-fwd-1");
    expect(ex).toBeDefined();
    expect(ex!.title).toBe("Slurp one");
    expect(ex!.category).toBe("slurp-barf");
  });

  it("getNextInCategory returns next exercise in same category", () => {
    const next = getNextInCategory("nav-right-1");
    expect(next).toBeDefined();
    expect(next!.category).toBe("navigation");
    expect(next!.id).toBe("nav-left-1");
  });

  it("getNextInCategory returns undefined at end of category", () => {
    const navExercises = getExercisesByCategory("navigation");
    const lastId = navExercises[navExercises.length - 1].id;
    expect(getNextInCategory(lastId)).toBeUndefined();
  });
});

describe("exercise content validity", () => {
  it("navigation exercises don't change code, only cursor", () => {
    const navExercises = getExercisesByCategory("navigation");
    for (const ex of navExercises) {
      expect(ex.startCode).toBe(ex.targetCode);
    }
  });

  it("mutation exercises change the code OR cursor (except round-trips)", () => {
    const mutCategories: CategoryId[] = [
      "slurp-barf",
      "raise-splice",
      "wrap",
      "transpose",
      "delete",
      "combos",
    ];
    const roundTrips = new Set(["slurp-barf-round-trip"]);
    for (const cat of mutCategories) {
      const catExercises = getExercisesByCategory(cat);
      for (const ex of catExercises) {
        if (roundTrips.has(ex.id)) continue;
        const changed =
          ex.startCode !== ex.targetCode ||
          ex.startCursorText !== ex.targetCursorText;
        expect(changed).toBe(true);
      }
    }
  });

  it("all exercises have a valid promptMode", () => {
    const validModes = new Set(["ghost", "spotlight", "beforeAfter", "puzzle"]);
    for (const ex of exercises) {
      expect(validModes.has(ex.promptMode)).toBe(true);
    }
  });

  it("all exercises have a non-empty actions array", () => {
    for (const ex of exercises) {
      expect(ex.actions.length, `${ex.id} has no actions`).toBeGreaterThan(0);
    }
  });
});
