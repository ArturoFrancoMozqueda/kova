import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { copy } from "../i18n/messages";
import { login, signup, verifyEmail } from "./api";

type AuthMode = "login" | "signup";
type ActionState = "idle" | "submitting" | "error" | "created" | "verified";

export default function AuthView({ mode }: { mode: AuthMode }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [state, setState] = useState<ActionState>("idle");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState("submitting");
    try {
      if (mode === "login") {
        await login({ email, password });
        navigate("/");
        return;
      }
      const response = await signup({ email, password, tenant_name: tenantName });
      setVerificationToken(response.dev_verification_token ?? "");
      setState("created");
    } catch {
      setState("error");
    }
  };

  const verify = async () => {
    setState("submitting");
    try {
      await verifyEmail(verificationToken);
      setState("verified");
    } catch {
      setState("error");
    }
  };

  return (
    <main className="page auth-page">
      <header className="hero">
        <p className="eyebrow">{copy.auth.secureAccess}</p>
        <h1>{mode === "login" ? copy.auth.loginTitle : copy.auth.signupTitle}</h1>
      </header>

      <section className="panel auth-panel">
        <form onSubmit={(event) => void submit(event)}>
          {mode === "signup" ? (
            <label>
              {copy.auth.tenantName}
              <input
                required
                autoComplete="organization"
                value={tenantName}
                onChange={(event) => setTenantName(event.target.value)}
              />
            </label>
          ) : null}
          <label>
            {copy.auth.email}
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            {copy.auth.password}
            <input
              required
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <div className="button-row">
            <button type="submit" disabled={state === "submitting"}>
              {state === "submitting" ? copy.auth.submitting : mode === "login" ? copy.auth.login : copy.auth.signup}
            </button>
            <Link className="text-link" to={mode === "login" ? "/signup" : "/login"}>
              {mode === "login" ? copy.auth.needAccount : copy.auth.haveAccount}
            </Link>
          </div>
        </form>

        {state === "error" ? (
          <p className="status-warn" role="alert">
            {copy.auth.operationError}
          </p>
        ) : null}
        {state === "created" ? (
          <div className="notice-stack">
            <p className="notice" role="status">
              {verificationToken ? copy.auth.devVerifyReady : copy.auth.checkEmail}
            </p>
            {verificationToken ? (
              <>
                <label>
                  {copy.auth.verificationToken}
                  <input value={verificationToken} onChange={(event) => setVerificationToken(event.target.value)} />
                </label>
                <button type="button" onClick={() => void verify()} disabled={!verificationToken}>
                  {copy.auth.verifyEmail}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {state === "verified" ? (
          <p className="notice" role="status">
            {copy.auth.verified}
          </p>
        ) : null}
      </section>
    </main>
  );
}
