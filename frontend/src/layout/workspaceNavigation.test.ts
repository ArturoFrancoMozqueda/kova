import { describe, expect, it } from "vitest";
import { buildWorkspaceNavigation, readExpandedNavigationGroups, workspaceGroupForPath, workspaceGroups } from "./workspaceNavigation";

describe("task workspaces", () => {
  it.each(["invalid-json", "null", "[]", '{"sales":"false","customers":true,"unknown":true}'])("validates stored preferences: %s", stored => {
    window.localStorage.setItem("group-preference-test", stored);
    expect(readExpandedNavigationGroups("group-preference-test")).toEqual(stored.includes('"customers"') ? { customers: true } : {});
    window.localStorage.removeItem("group-preference-test");
  });
  it.each([
    ["/pedidos/nuevo", undefined], ["/purchasing/orders/123", "operation"],
    ["/appointments/123", "customers"], ["/settings/public-catalog", "sales"],
    ["/settings/public-catalog/preview", "sales"], ["/settings/channels", "settings"],
    ["/settings/receipt", "settings"], ["/reports", "analysis"], ["/register", undefined],
    ["/customers-unrelated", undefined],
  ])("finds the precise scope of %s", (path, expected) => {
    expect(workspaceGroupForPath(path)).toBe(expected);
  });

  it("keeps every supplied workspace destination exactly once", () => {
    const destinations = workspaceGroups.flatMap(group => group.paths.map(to => ({ to })));
    const navigation = buildWorkspaceNavigation(destinations);
    const paths = navigation.flatMap(group => group.items.map(item => item.to));
    expect(paths).toEqual(destinations.map(item => item.to));
    expect(new Set(paths).size).toBe(paths.length);
    expect(navigation.map(group => group.id)).toEqual(["sales", "customers", "operation", "analysis", "settings"]);
  });

  it("chooses an allowed landing page and never invents a forbidden destination", () => {
    const destinations = [{ to: "/inventory" }, { to: "/loyalty" }];
    const navigation = buildWorkspaceNavigation(destinations);
    expect(navigation).toEqual([
      { id: "customers", destination: destinations[1], items: [destinations[1]] },
      { id: "operation", destination: destinations[0], items: [destinations[0]] },
    ]);
    expect(buildWorkspaceNavigation([])).toEqual([]);
    expect(destinations).toEqual([{ to: "/inventory" }, { to: "/loyalty" }]);
  });
});
