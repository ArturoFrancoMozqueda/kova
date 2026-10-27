import { describe, expect, it } from "vitest";
import { isLoyaltyCardPage, isPrivateCustomerPage, redactCardLink, redactCardTelemetry } from "./cardPrivacy";

describe("digital card telemetry privacy", () => {
  it("removes capabilities from full, relative and encoded card links", () => {
    for (const link of ["https://kovasuite.com/lealtad#private-capability", "/lealtad/#private-capability", "/lealtad%23private-capability", "/lealtad?utm_source=whatsapp#private-capability", "/lealtad///?source=card%23private-capability"]) {
      expect(redactCardLink(link)).not.toContain("private-capability");
      expect(redactCardLink(link)).toContain("[redacted]");
    }
  });

  it("scrubs nested request, breadcrumb and error fields without changing the original event", () => {
    const link = "https://kovasuite.com/lealtad#private-capability";
    const event = { request: { url: link }, breadcrumbs: [{ data: { to: link } }], exception: { values: [{ value: `Error at ${link}` }] }, tags: { area: "loyalty" }, timestamp: 123, extra: null };
    const sanitized = redactCardTelemetry(event);
    expect(JSON.stringify(sanitized)).not.toContain("private-capability");
    expect(event.request.url).toBe(link);
    expect(sanitized.tags).toEqual({ area: "loyalty" });
    expect(sanitized.timestamp).toBe(123);
    expect(sanitized.extra).toBeNull();
  });

  it("identifies only public card pages and leaves merchant links intact", () => {
    expect(isLoyaltyCardPage("/lealtad")).toBe(true);
    expect(isLoyaltyCardPage("/lealtad/")).toBe(true);
    expect(isLoyaltyCardPage("/lealtad///")).toBe(true);
    expect(isLoyaltyCardPage("/loyalty")).toBe(false);
    expect(redactCardLink("/catalogo/cafeteria#menu")).toBe("/catalogo/cafeteria#menu");
    expect(isPrivateCustomerPage("/seguimiento/")).toBe(true);
    expect(isPrivateCustomerPage("/pedidos/123")).toBe(false);
    expect(redactCardLink("/seguimiento?source=menu#private-order")).toBe("/seguimiento?source=menu#[redacted]");
  });
});
