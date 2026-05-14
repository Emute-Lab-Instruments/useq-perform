import { render } from "solid-js/web";
import ZenMode from "./ZenMode";
import { enterExercise } from "./store";
import { getExercise } from "./exercises";
import { isZenRoute, parseZenHash } from "./routing";

export { isZenRoute };

export function mountZenMode(): void {
  const { exerciseId } = parseZenHash(window.location.hash);
  if (exerciseId) {
    const ex = getExercise(exerciseId);
    if (ex) enterExercise(ex.id);
  }

  const root = document.createElement("div");
  root.id = "zen-root";
  document.body.appendChild(root);

  render(() => <ZenMode />, root);
}
