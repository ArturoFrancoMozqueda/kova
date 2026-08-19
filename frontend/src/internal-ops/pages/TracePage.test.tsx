import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TracePage from "./TracePage";

const useTrace = vi.fn();
vi.mock("../hooks", () => ({ useTrace: (p: unknown) => useTrace(p) }));

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <TracePage />
    </MemoryRouter>,
  );
}

describe("TracePage", () => {
  beforeEach(() => useTrace.mockReset());

  it("shows a hint and passes empty params when no querystring is present", () => {
    useTrace.mockReturnValue({ isFetching: false, isError: false, data: undefined });
    renderAt("/internal/ops/trace");
    expect(useTrace).toHaveBeenLastCalledWith({});
    expect(screen.getByText(/Ingresa un identificador o rango/)).toBeInTheDocument();
  });

  it("hydrates the query from the querystring", () => {
    useTrace.mockReturnValue({
      isFetching: false,
      isError: false,
      data: {
        generated_at: "2026-01-01T00:00:00Z",
        query: {},
        timeline: [],
        sources_queried: { local_db: "ok", sentry: "not_configured" },
        deep_links: {},
      },
    });
    renderAt("/internal/ops/trace?request_id=abc-123");
    expect(useTrace).toHaveBeenLastCalledWith({ request_id: "abc-123" });
    // sources_queried surfaced honestly
    expect(screen.getByText(/local_db/)).toBeInTheDocument();
  });
});
