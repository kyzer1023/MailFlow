import { Outlet } from "react-router-dom";
import { DraftProvider } from "../state/draft-context";
import { RouteBoundary } from "./RouteBoundary";

export default function ProductLayout() {
  // Keep the draft mounted while individual screens load or recover from errors.
  return (
    <DraftProvider>
      <RouteBoundary>
        <Outlet />
      </RouteBoundary>
    </DraftProvider>
  );
}
