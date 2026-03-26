import { render } from "solid-js/web";
import Inspector from "./app/Inspector";
import "./inspector.css";

const root = document.getElementById("inspector-root");
if (root) {
  render(() => <Inspector />, root);
}
