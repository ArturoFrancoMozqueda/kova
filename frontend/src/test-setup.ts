import "@testing-library/jest-dom/vitest";

// jsdom ships neither IntersectionObserver nor matchMedia. Framer Motion's
// scroll primitives (useInView / whileInView) and our <Reveal> depend on both,
// so provide test-only shims here to keep motion components mounting cleanly.
//
// The IntersectionObserver shim reports every observed target as intersecting
// immediately — matching the fallback semantics the app already relied on when
// IntersectionObserver was simply absent (content shown, not hidden). This
// keeps <Reveal> content visible in component tests. Individual tests may still
// override it with vi.stubGlobal for stricter control.
if (typeof globalThis.IntersectionObserver === "undefined") {
  class ImmediateIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = "";
    readonly thresholds: ReadonlyArray<number> = [];
    private callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element): void {
      this.callback(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this,
      );
    }
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  globalThis.IntersectionObserver =
    ImmediateIntersectionObserver as unknown as typeof IntersectionObserver;
}

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
