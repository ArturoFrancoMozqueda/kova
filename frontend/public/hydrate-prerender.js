/* global document, window */

(() => {
  const entry = document.currentScript?.dataset.entry;
  if (!entry) return;

  // Public pages already contain useful server-rendered HTML and working
  // links. Let that content paint before downloading the React application.
  window.setTimeout(() => {
    void import(entry);
  }, 750);
})();
