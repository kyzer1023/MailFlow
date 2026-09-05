import "./frontend-preview-fixture.js";
history.replaceState({}, "", "/flows/new/data");
await import("../src/main.tsx");
