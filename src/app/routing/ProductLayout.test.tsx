import React, { lazy } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiContext, fallbackConfig } from "../state/api-context";
import { useDraft } from "../state/draft-context";
import ProductLayout from "./ProductLayout";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Editor() {
  const { draft, updateDraft } = useDraft();
  return (
    <>
      <input
        aria-label="Subject"
        value={draft.subject}
        onChange={(event) => updateDraft("subject", event.target.value)}
      />
      <Link to="/next">Next</Link>
    </>
  );
}
function NextPage() {
  const { draft } = useDraft();
  return (
    <>
      <p>{draft.subject}</p>
      <Link to="/dashboard">Back</Link>
    </>
  );
}
function renderRoutes(next: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <ApiContext.Provider
        value={{
          status: "authenticated",
          user: null,
          csrfToken: "synthetic",
          config: fallbackConfig,
          isLive: true,
          dashboard: {
            status: "idle",
            flows: null,
            campaigns: null,
            error: "",
          },
          refreshDashboard: async () => {},
          setSession: () => {},
        }}
      >
        <Routes>
          <Route element={<ProductLayout />}>
            <Route path="/dashboard" element={<Editor />} />
            <Route path="/next" element={next} />
          </Route>
        </Routes>
      </ApiContext.Provider>
    </MemoryRouter>,
  );
}

it("retains the draft across a suspended route and back navigation", async () => {
  let resolve!: (module: { default: typeof NextPage }) => void;
  const Next = lazy(
    () =>
      new Promise<{ default: typeof NextPage }>((done) => {
        resolve = done;
      }),
  );
  renderRoutes(<Next />);
  fireEvent.change(screen.getByLabelText("Subject"), {
    target: { value: "Keep this draft" },
  });
  fireEvent.click(screen.getByText("Next"));
  // Router transitions keep the existing screen usable while the next chunk loads.
  expect(screen.getByLabelText("Subject")).toHaveValue("Keep this draft");
  await act(async () => resolve({ default: NextPage }));
  expect(screen.getByText("Keep this draft")).toBeVisible();
  fireEvent.click(screen.getByText("Back"));
  expect(screen.getByLabelText("Subject")).toHaveValue("Keep this draft");
});

it("recovers to a previous route without clearing the draft after a chunk fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const Failed = lazy(async () => {
    throw new Error("Chunk unavailable");
  });
  renderRoutes(<Failed />);
  fireEvent.change(screen.getByLabelText("Subject"), {
    target: { value: "Recover this draft" },
  });
  fireEvent.click(screen.getByText("Next"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This page could not load.",
  );
  fireEvent.click(screen.getByRole("link", { name: "Return to home" }));
  expect(screen.getByLabelText("Subject")).toHaveValue("Recover this draft");
});
