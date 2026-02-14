// src/islands/test-island.tsx
import { render } from "solid-js/web";
import { TestComponent } from "../ui/TestComponent";

const root = document.getElementById("test-island");
if (root) {
  render(() => <TestComponent />, root);
}
