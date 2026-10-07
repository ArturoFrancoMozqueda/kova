import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import RouteIndexing from "./RouteIndexing";

const robots = () => document.querySelector<HTMLMetaElement>('meta[name="robots"]');

function renderIndexing(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RouteIndexing />
      <Link to="/seguridad">Seguridad</Link>
      <Link to="/">Inicio</Link>
    </MemoryRouter>,
  );
}

afterEach(() => {
  document.querySelectorAll('meta[name="robots"]').forEach((meta) => meta.remove());
});

describe("route indexing", () => {
  it.each(["/signup", "/login", "/seguridad", "/privacy", "/terms", "/cookies", "/dashboard", "/unknown"])(
    "keeps %s out of search after React renders",
    (path) => {
      renderIndexing(path);
      expect(robots()?.content).toBe("noindex");
    },
  );

  it("updates the policy when navigating from the landing to security and back", () => {
    renderIndexing("/");
    expect(robots()).toBeNull();
    fireEvent.click(screen.getByText("Seguridad"));
    expect(robots()?.content).toBe("noindex");
    fireEvent.click(screen.getByText("Inicio"));
    expect(robots()).toBeNull();
  });

  it("reuses the server directive and clears it when returning to the landing", () => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    renderIndexing("/signup");
    expect(robots()).toBe(meta);
    expect(document.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
    fireEvent.click(screen.getByText("Inicio"));
    expect(robots()).toBeNull();
  });
});
