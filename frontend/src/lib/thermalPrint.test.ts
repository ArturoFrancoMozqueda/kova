import { afterEach, describe, expect, it } from "vitest";
import { installThermalPrinting, prepareThermalPrint } from "./thermalPrint";

afterEach(() => { document.body.innerHTML = ""; });

describe("thermal print isolation", () => {
  it("leaves accountant reports and pages without receipts unchanged", () => {
    document.body.innerHTML = '<div class="print-accountant-report-root">Cierre</div>';
    const cleanup = prepareThermalPrint(document);
    expect(document.body.hasAttribute("data-thermal-printing")).toBe(false);
    expect(document.querySelector(".thermal-print-document")).toBeNull();
    cleanup();
  });

  it("prints the current receipt once and restores the original DOM after every dialog", () => {
    document.body.innerHTML = '<main><div class="print-receipt-root" data-paper-width="58">Venta vigente</div></main>';
    const uninstall = installThermalPrinting(window);
    const source = document.querySelector("main")!.innerHTML;
    const head = document.head.innerHTML;
    for (let i = 0; i < 2; i++) {
      window.dispatchEvent(new Event("beforeprint"));
      expect(document.querySelectorAll(".thermal-print-document")).toHaveLength(1);
      expect(document.querySelector(".thermal-print-document")).toHaveTextContent("Venta vigente");
      window.dispatchEvent(new Event("afterprint"));
      expect(document.querySelectorAll(".thermal-print-document")).toHaveLength(0);
      expect(document.querySelector("main")!.innerHTML).toBe(source);
      expect(document.head.innerHTML).toBe(head);
    }
    uninstall();
  });
});
