import { normalizeReceiptPaperWidth } from "./receiptPaper";

/** Print only the committed receipt/corte, on a measured roll-sized page. */
export function prepareThermalPrint(doc: Document): () => void {
  const source = doc.querySelector<HTMLElement>(".print-receipt-root, .print-corte-root");
  if (!source) return () => undefined; // Accountant reports keep their A4 layout.
  const width = normalizeReceiptPaperWidth(source.dataset.paperWidth);
  const sideMargin = width === 58 ? 5 : 4;
  const contentWidth = width - 2 * sideMargin;
  const printable = source.cloneNode(true) as HTMLElement;
  printable.removeAttribute("id");
  printable.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
  printable.setAttribute("aria-hidden", "true");
  printable.classList.add("thermal-print-measure");
  printable.style.width = `${contentWidth}mm`;
  doc.body.append(printable);
  // CSS pixels use 96 dpi. Round up and include top/bottom paper margins.
  // Long receipts paginate rather than requesting unbounded driver dimensions.
  const height = Math.min(2000, Math.max(40,
    Math.ceil(printable.getBoundingClientRect().height * 25.4 / 96) + 7));
  printable.classList.remove("thermal-print-measure");
  printable.classList.add("thermal-print-document");
  const style = doc.createElement("style");
  style.textContent = `@media print { @page receipt-${width} {
    size: ${width}mm ${height}mm; margin: 3mm ${sideMargin}mm;
  } }`;
  doc.head.append(style);
  doc.body.setAttribute("data-thermal-printing", "");
  return () => {
    printable.remove();
    style.remove();
    doc.body.removeAttribute("data-thermal-printing");
  };
}

export function installThermalPrinting(target: Window): () => void {
  let dispose: () => void = () => undefined;
  const before = () => {
    dispose();
    dispose = prepareThermalPrint(target.document);
  };
  const after = () => {
    dispose();
    dispose = () => undefined;
  };
  target.addEventListener("beforeprint", before);
  target.addEventListener("afterprint", after);
  return () => {
    after();
    target.removeEventListener("beforeprint", before);
    target.removeEventListener("afterprint", after);
  };
}
