import { hydrate, render } from "solid-js/web";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");
if (root) {
  // Das HTML ist beim Build vorgerendert (scripts/prerender.mjs) → hydratisieren.
  // Ohne vorgerendertes Markup (z. B. im Dev-Server) normal rendern.
  if (root.firstChild) hydrate(() => <App />, root);
  else render(() => <App />, root);
}
