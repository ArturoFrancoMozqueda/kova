import { expect, it } from "vitest";
import { env } from "cloudflare:test";

  it("isolates background execution from owner database access and rejects unknown tenants", async () => {
    const allowed = "00000000-0000-4000-8000-000000000001";
    const stub = env.TEST_JOBS.getByName(allowed);
    expect(await stub.wake(crypto.randomUUID())).toBe(false);
    expect(await stub.wake(allowed)).toBe(true);
    expect(await stub.wake(allowed)).toBe(true);
  });

