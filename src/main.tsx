import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./app/styles/wizard.css";
import "./app/styles/campaign.css";
import "./app/styles/visual-polish.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Mail Flow could not find its application root.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
