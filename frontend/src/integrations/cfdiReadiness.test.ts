import { describe, expect, it } from "vitest";
import { liveCfdiReady } from "./cfdiReadiness";
import type { CfdiConnection } from "./cfdiApi";
const connection: CfdiConnection = {
  environment: "live",
  organization_id: "org-1",
  connected: true,
  issuer_rfc: "EKU9003173C9",
  production_ready: true,
  certificate_expires_at: "2099-01-01T00:00:00Z",
};
describe("Live emission readiness", () => {
  it("requires server storage, matching issuer, ready production status and unexpired certificate", () => {
    expect(liveCfdiReady(connection, true, connection.issuer_rfc!)).toBe(true);
    expect(liveCfdiReady(connection, false, connection.issuer_rfc!)).toBe(
      false,
    );
    expect(liveCfdiReady(connection, true, "AAA010101AAA")).toBe(false);
    expect(
      liveCfdiReady(
        { ...connection, environment: "test" },
        true,
        connection.issuer_rfc!,
      ),
    ).toBe(false);
    expect(
      liveCfdiReady(
        { ...connection, connected: false },
        true,
        connection.issuer_rfc!,
      ),
    ).toBe(false);
    expect(
      liveCfdiReady(
        { ...connection, production_ready: false },
        true,
        connection.issuer_rfc!,
      ),
    ).toBe(false);
    expect(
      liveCfdiReady(
        { ...connection, certificate_expires_at: null },
        true,
        connection.issuer_rfc!,
      ),
    ).toBe(false);
    expect(
      liveCfdiReady(
        { ...connection, certificate_expires_at: "2020-01-01T00:00:00Z" },
        true,
        connection.issuer_rfc!,
      ),
    ).toBe(false);
    expect(
      liveCfdiReady(
        { ...connection, certificate_expires_at: "invalid" },
        true,
        connection.issuer_rfc!,
      ),
    ).toBe(false);
  });
});
