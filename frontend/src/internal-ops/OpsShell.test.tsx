import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import OpsShell from "./OpsShell";

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/internal/ops"]}>
      <Routes>
        <Route path="/internal/ops" element={<OpsShell />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("OpsShell", () => {
  it("adds and removes the noindex robots meta tag", () => {
    const { unmount } = renderShell();
    const meta = document.head.querySelector('meta[name="robots"]');
    expect(meta?.getAttribute("content")).toBe("noindex, nofollow");
    unmount();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it("renders all seven nav links", () => {
    const { getAllByRole } = renderShell();
    const links = getAllByRole("link");
    expect(links).toHaveLength(7);
  });
});
