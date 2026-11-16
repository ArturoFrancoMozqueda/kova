import { WorkerEntrypoint } from "cloudflare:workers";

// Deliberately separate from the incumbent controller. The signed-up merchant's
// key is stored once here; all business tokens are encrypted in tenant storage.
// No public HTTP path or caller-chosen configuration field is exposed.
export class SignupSettings extends WorkerEntrypoint {
  async getRuntimeEnvironment(input) {
    const original = await this.env.ORIGINAL.getRuntimeEnvironment(input);
    const extra = {};
    for (const name of ["WHATSAPP_APP_ID", "WHATSAPP_SIGNUP_CONFIG_ID",
      "WHATSAPP_SIGNUP_ENABLED", "WHATSAPP_CREDENTIALS_KEY"]) {
      if (typeof this.env[name] === "string") extra[name] = this.env[name];
    }
    return { ...original, ...extra };
  }
}
export default { fetch() { return new Response(null, { status: 404 }); } };
