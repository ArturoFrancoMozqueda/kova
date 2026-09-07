import { Component, ErrorInfo, ReactNode } from "react";
import { reportError } from "./observability/errorReporting";
import { isStaleAssetError, requestPwaReload } from "./pwaUpdate";

type Props = { children: ReactNode };
type State = { hasError: boolean };

// Inline styles on purpose: the boundary must render even if app CSS or other
// modules failed to load.
const wrap: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.75rem",
  padding: "2rem",
  textAlign: "center",
  fontFamily: "Inter, system-ui, sans-serif",
};

const button: React.CSSProperties = {
  marginTop: "0.5rem",
  padding: "0.625rem 1.25rem",
  borderRadius: "8px",
  border: "none",
  background: "#4F7EF7",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isStaleAssetError(error)) {
      if (requestPwaReload()) return;
    }

    // Report render crashes to Sentry (no-op when DSN is unset) with the
    // component stack so production errors are visible, not just console-only.
    // reportError loads Sentry on demand and queues until it's ready.
    reportError(error, { componentStack: info.componentStack });
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" style={wrap}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#0F1117" }}>
            Algo salió mal
          </h1>
          <p style={{ color: "#6B7A99", maxWidth: "28rem", lineHeight: 1.5 }}>
            Tuvimos un problema al mostrar esta pantalla. Recarga para continuar;
            si vuelve a pasar, inténtalo de nuevo en un momento.
          </p>
          <button type="button" style={button} onClick={() => window.location.reload()}>
            Recargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
