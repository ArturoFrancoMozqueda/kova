import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExternalLink } from "./ExternalLink";

describe("ExternalLink", () => {
  it("renders a trusted HTTPS dashboard link", () => {
    render(<ExternalLink label="Sentry" url="https://acme.sentry.io/issues/1/" />);
    expect(screen.getByRole("link", { name: /Sentry/ })).toHaveAttribute(
      "href",
      "https://acme.sentry.io/issues/1/",
    );
  });

  it("does not render untrusted navigation targets", () => {
    render(<ExternalLink label="Sentry" url="javascript:alert(1)" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
