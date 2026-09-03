import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./app/styles/index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Mail Flow could not find its application root.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
