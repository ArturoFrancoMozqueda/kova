import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SaleFlowStory from "./SaleFlowStory";

class VisibleIntersectionObserver {
  private callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback(
      [
        {
          isIntersecting: true,
          intersectionRatio: 0.75,
          target,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }

  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = "0px";
  thresholds = [0, 0.35, 0.75];
}

describe("SaleFlowStory", () => {
  const onCtaClick = vi.fn();
  const onStepView = vi.fn();
  const play = vi.fn().mockResolvedValue(undefined);
  const pause = vi.fn();

  beforeEach(() => {
    onCtaClick.mockClear();
    onStepView.mockClear();
    play.mockClear();
    pause.mockClear();
    vi.stubGlobal("IntersectionObserver", VisibleIntersectionObserver);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
  });

  function renderStory() {
    return render(
      <MemoryRouter>
        <SaleFlowStory
          primaryTarget="/signup"
          onCtaClick={onCtaClick}
          onStepView={onStepView}
        />
      </MemoryRouter>,
    );
  }

  it("selects the horizontal video on desktop", () => {
    const { container } = renderStory();
    const video = screen.getByLabelText(
      "Demostración de Kova: venta, inventario, caja y análisis",
    );

    expect(video).toHaveAttribute("src", "/film/kova-demo-horizontal.mp4");
    expect(video.querySelector("track[kind='captions']")).toHaveAttribute(
      "src",
      "/film/kova-demo-es.vtt",
    );
    expect(
      container.querySelector("picture source[media='(max-width: 700px)']"),
    ).toHaveAttribute("srcset", "/film/kova-demo-vertical.webp");
  });

  it("selects the vertical video on mobile", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    renderStory();

    expect(
      screen.getByLabelText("Demostración de Kova: venta, inventario, caja y análisis"),
    ).toHaveAttribute("src", "/film/kova-demo-vertical.mp4");
  });

  it("starts muted when the video enters the viewport", () => {
    renderStory();

    expect(play).toHaveBeenCalledTimes(1);
    expect(onStepView).toHaveBeenCalledWith("sale", "scroll");
    expect(
      screen.getByLabelText("Demostración de Kova: venta, inventario, caja y análisis"),
    ).toHaveProperty("muted", true);
  });

  it("offers accessible playback and sound controls", () => {
    renderStory();
    const video = screen.getByLabelText(
      "Demostración de Kova: venta, inventario, caja y análisis",
    ) as HTMLVideoElement;

    fireEvent.click(screen.getByRole("button", { name: "Activar sonido" }));
    expect(video.muted).toBe(false);
    expect(screen.getByRole("button", { name: "Silenciar" })).toBeVisible();

    fireEvent.playing(video);
    Object.defineProperty(video, "paused", { configurable: true, get: () => false });
    fireEvent.click(screen.getByRole("button", { name: "Pausar" }));
    expect(pause).toHaveBeenCalled();
  });

  it("uses the signup destination for the story CTA", () => {
    renderStory();
    const cta = screen.getByRole("link", { name: "Probar Kova gratis" });
    expect(cta).toHaveAttribute("href", "/signup");
    fireEvent.click(cta);
    expect(onCtaClick).toHaveBeenCalledTimes(1);
  });
});
