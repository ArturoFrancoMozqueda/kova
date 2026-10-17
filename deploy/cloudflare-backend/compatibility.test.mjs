import { expect, it } from "vitest";
import { env } from "cloudflare:test";
import { createDecipheriv, createHmac, timingSafeEqual } from "node:crypto";

  it("keeps existing encrypted credentials and certificate rejection rules compatible", async () => {
    const fixtures = env.TEST_FIXTURES;
    const response = await env.TEST_CRYPTO.fetch("https://compatibility.test", {
      method: "POST", body: JSON.stringify(fixtures),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    for (const item of result.cases) expect(item.actual, item.label).toBe(item.expected);
    const key = Buffer.from(fixtures.fernet_key, "base64url");
    const token = Buffer.from(result.fernet, "base64url");
    const expected = createHmac("sha256", key.subarray(0, 16)).update(token.subarray(0, -32)).digest();
    expect(timingSafeEqual(token.subarray(-32), expected)).toBe(true);
    const cbc = createDecipheriv("aes-128-cbc", key.subarray(16), token.subarray(9, 25));
    expect(Buffer.concat([cbc.update(token.subarray(25, -32)), cbc.final()]).toString())
      .toBe("synthetic-worker-credential");
    const ciphertext = Buffer.from(result.gcm, "base64");
    const gcm = createDecipheriv("aes-256-gcm", Buffer.from(fixtures.gcm_key, "base64"),
      Buffer.from(fixtures.nonce, "base64"));
    gcm.setAAD(Buffer.from(fixtures.aad, "base64"));
    gcm.setAuthTag(ciphertext.subarray(-16));
    expect(Buffer.concat([gcm.update(ciphertext.subarray(0, -16)), gcm.final()]).toString())
      .toBe("worker-token");
    expect(Buffer.from(result.qr.split(",")[1], "base64").subarray(0, 8))
      .toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    let sent = [];
    for (let attempt = 0; attempt < 10 && !sent.length; attempt++) {
      const mailbox = await env.TEST_MAILBOX.fetch("https://mailbox.test/");
      sent = (await mailbox.json()).telemetry;
      if (!sent.length) await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.join("\n")).toContain("workers-transport-qa");
    expect(sent.join("\n")).not.toContain("private-qa@example.com");
    expect(sent.join("\n")).not.toContain("private-cookie-qa");
  });

