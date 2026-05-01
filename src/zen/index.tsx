import { render } from "solid-js/web";
import ZenMode from "./ZenMode";
import { enterExercise } from "./store";
import { getExercise } from "./exercises";

export function isZenRoute(): boolean {
  return window.location.hash.startsWith("#/zen");
}

export function mountZenMode(): void {
  const params = parseZenRoute();
  if (params.exerciseId) {
    const ex = getExercise(params.exerciseId);
    if (ex) enterExercise(ex.id);
  }

  const root = document.createElement("div");
  root.id = "zen-root";
  document.body.appendChild(root);

  render(() => <ZenMode />, root);
}

function parseZenRoute(): { exerciseId: string | null } {
  const hash = window.location.hash;
  const parts = hash.replace("#/zen", "").split("/").filter(Boolean);
  if (parts.length >= 1) {
    return { exerciseId: parts.join("-") };
  }
  return { exerciseId: null };
}
