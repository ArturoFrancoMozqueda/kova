import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";

// jsdom no implementa reproducción multimedia. La landing usa estos métodos
// para iniciar y pausar el demo cuando entra o sale del viewport.
if (typeof HTMLMediaElement !== "undefined") {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: () => Promise.resolve(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: () => undefined,
  });
}
