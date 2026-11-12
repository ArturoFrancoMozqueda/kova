// Credentials and authorization codes remain in memory until the authenticated
// server exchanges them. Never persist them, navigate with them or log events.
export type MetaSdk = {
  init(options: { appId: string; version: string; autoLogAppEvents: false; xfbml: false }): void;
  login(callback: (response: { authResponse?: { code?: string } }) => void,
    options: { config_id: string; response_type: "code"; override_default_response_type: true;
      extras: { setup: Record<string, never> } }): void;
};

declare global {
  interface Window { FB?: MetaSdk; fbAsyncInit?: () => void }
}

let loading: Promise<MetaSdk> | undefined;
let configuration = "";

export function loadMetaSdk(appId: string, version: string): Promise<MetaSdk> {
  const requested = `${appId}:${version}`;
  if (configuration && configuration !== requested) return Promise.reject(new Error("sdk_config"));
  if (loading) return loading;
  configuration = requested;
  loading = new Promise<MetaSdk>((resolve, reject) => {
    const script = document.createElement("script");
    let timer: ReturnType<typeof setTimeout>;
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      loading = undefined;
      configuration = "";
      reject(new Error("sdk_unavailable"));
    };
    const initialize = () => {
      if (!window.FB) { fail(); return; }
      try {
        window.FB.init({ appId, version, autoLogAppEvents: false, xfbml: false });
        clearTimeout(timer);
        resolve(window.FB);
      } catch { fail(); }
    };
    timer = setTimeout(fail, 15_000);
    if (window.FB) { initialize(); return; }
    window.fbAsyncInit = initialize;
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = fail;
    document.head.append(script);
  });
  return loading;
}

export type SignupResult = { code: string; waba_id: string; phone_number_id: string; event: "FINISH" };

export function launchMetaSignup(sdk: MetaSdk, configId: string,
  finish: (result: SignupResult) => void, failed: (reason: "cancelled" | "incomplete" | "failed") => void) {
  let code: string | undefined;
  let assets: { waba_id: string; phone_number_id: string } | undefined;
  let settled = false;
  const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", onMessage); };
  const failure = (reason: "cancelled" | "incomplete" | "failed") => {
    if (settled) return;
    settled = true; cleanup(); code = undefined; assets = undefined; failed(reason);
  };
  const complete = () => {
    if (settled || !code || !assets) return;
    settled = true; cleanup();
    const result: SignupResult = { code, ...assets, event: "FINISH" };
    code = undefined; assets = undefined; finish(result);
  };
  const onMessage = (event: MessageEvent) => {
    if (!new Set(["https://www.facebook.com", "https://web.facebook.com"]).has(event.origin)
        || typeof event.data !== "string" || event.data.length > 16_384) return;
    try {
      const payload = JSON.parse(event.data);
      if (payload?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (payload.event === "CANCEL") { failure("cancelled"); return; }
      if (payload.event === "ERROR") { failure("failed"); return; }
      if (payload.event !== "FINISH") { failure("incomplete"); return; }
      const { waba_id, phone_number_id } = payload.data ?? {};
      const valid = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{0,31}$/.test(value);
      if (!valid(waba_id) || !valid(phone_number_id)) { failure("incomplete"); return; }
      assets = { waba_id, phone_number_id }; complete();
    } catch { /* Ignore unrelated/malformed postMessage data, never print it. */ }
  };
  let timer = setTimeout(() => failure("incomplete"), 5 * 60_000);
  window.addEventListener("message", onMessage);
  try {
    // This call must stay synchronous inside the user's click, after preparation.
    sdk.login(response => {
      if (settled) return;
      const value = response.authResponse?.code;
      if (!value || value.length > 8192) { failure("cancelled"); return; }
      code = value;
      // Meta codes expire after 30 seconds. Never wait on a dialog after this.
      clearTimeout(timer);
      timer = setTimeout(() => { if (!settled) failure("incomplete"); }, 10_000);
      complete();
    }, { config_id: configId, response_type: "code", override_default_response_type: true,
      extras: { setup: {} } });
  } catch { failure("failed"); }
  return () => { settled = true; cleanup(); code = undefined; assets = undefined; };
}
