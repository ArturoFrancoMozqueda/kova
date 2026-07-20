/* global document, window */

(() => {
  const entry = document.currentScript?.dataset.entry;
  if (!entry) return;

  // Public pages already contain useful server-rendered HTML and working
  // links. Let that content paint before downloading the React application.
  const hydrate = () => {
    void import(entry);
  };
  const hydrateAfterFirstPaint = () => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(hydrate, 100);
      });
    });
  };

  if (document.readyState === "complete") {
    hydrateAfterFirstPaint();
  } else {
    window.addEventListener("load", hydrateAfterFirstPaint, { once: true });
  }
})();
