import { bindings, defineConfig, exports } from "cf/config";

const source = process.env.KOVA_NATIVE_SIGNUP_SOURCE_SHA;
if (!/^[a-f0-9]{40}$/i.test(source ?? "")) throw new Error("Full signup settings source SHA required");
export default defineConfig({ worker: {
  name: "kova-native-signup-settings", entrypoint: "./signup-settings.mjs",
  compatibilityDate: "2026-11-12", compatibilityFlags: ["nodejs_compat"],
  workersDev: false, previewUrls: false,
  exports: { SignupSettings: exports.worker() },
  env: { ORIGINAL: bindings.worker({ worker: "kova-backend", exportName: "NativeSettings" }),
    KOVA_NATIVE_SIGNUP_SOURCE_SHA: bindings.text(source) },
  observability: { enabled: true, redactQueryString: true,
    logs: { enabled: true, invocationLogs: false },
    traces: { enabled: true, headSamplingRate: 0.05 } },
} });
