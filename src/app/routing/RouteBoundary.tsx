import { Component, Suspense, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { SpinnerGap, WarningCircle } from "@phosphor-icons/react";

class RouteErrorBoundary extends Component<
  { readonly children: ReactNode; readonly path: string },
  { failed: boolean; path: string }
> {
  state = { failed: false, path: this.props.path };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: { path: string },
    state: { path: string },
  ) {
    return props.path !== state.path
      ? { failed: false, path: props.path }
      : null;
  }

  render() {
    if (this.state.failed)
      return (
        <div className="route-gate" role="alert">
          <WarningCircle weight="fill" />
          <h1>This page could not load.</h1>
          <p>
            Check your connection, then reload. Reloading clears any unsaved
            draft.
          </p>
          <button
            className="button button--outline"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
          <Link className="button button--text" to="/dashboard">
            Return to home
          </Link>
        </div>
      );
    return this.props.children;
  }
}

export function RouteBoundary({ children }: { readonly children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <RouteErrorBoundary path={pathname}>
      <Suspense
        fallback={
          <div className="route-gate" role="status">
            <SpinnerGap className="spin" /> Loading Mail Flow...
          </div>
        }
      >
        {children}
      </Suspense>
    </RouteErrorBoundary>
  );
}
