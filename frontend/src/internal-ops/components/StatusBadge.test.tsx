import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { STATUS_STYLE, StatusBadge } from "./StatusBadge";
import type { OpsStatus } from "../types";

const ALL: OpsStatus[] = ["ok", "warning", "critical", "degraded", "not_configured"];

describe("StatusBadge", () => {
  it("renders a label for every status", () => {
    for (const status of ALL) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(STATUS_STYLE[status].label)).toBeInTheDocument();
      unmount();
    }
  });

  it("gives not_configured a dashed style", () => {
    expect(STATUS_STYLE.not_configured.className).toContain("dashed");
  });
});
