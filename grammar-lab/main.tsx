import { render } from "solid-js/web";
import App from "./App";
import "./lab.css";

const root = document.getElementById("grammar-lab-root");

if (!root) {
  throw new Error("Grammar Lab root element is missing");
}

render(() => <App />, root);
