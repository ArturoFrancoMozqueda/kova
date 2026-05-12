import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { copy } from "../i18n/messages";
import { verifyEmail } from "./api";

type State = "verifying" | "success" | "error" | "missing";

export default function VerifyEmailView() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<State>("verifying");

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setState("missing");
      return;
    }
    verifyEmail(token)
      .then(() => {
        setState("success");
        window.setTimeout(() => navigate("/login"), 2500);
      })
      .catch(() => setState("error"));
  }, [navigate, params]);

  return (
    <main className="page auth-page">
      <header className="hero">
        <p className="eyebrow">{copy.auth.secureAccess}</p>
        <h1>{copy.auth.verifyEmail}</h1>
      </header>
      <section className="panel auth-panel">
        {state === "verifying" && <p>{copy.auth.submitting}…</p>}
        {state === "success" && (
          <p className="notice" role="status">
            {copy.auth.verified}
          </p>
        )}
        {state === "error" && (
          <p className="status-warn" role="alert">
            {copy.auth.operationError}
          </p>
        )}
        {state === "missing" && (
          <p className="status-warn" role="alert">
            Missing verification token.
          </p>
        )}
      </section>
    </main>
  );
}
