import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../App";

describe("App shell", () => {
  it("renders the home placeholder", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /pos/i })).toBeInTheDocument();
    expect(screen.getByText(/offline queue shell/i)).toBeInTheDocument();
  });
});
