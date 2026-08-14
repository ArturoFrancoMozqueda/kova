import type { FullResult, Reporter, Suite } from "@playwright/test/reporter";

class ProductionSmokeReporter implements Reporter {
  private suite?: Suite;

  onBegin(_config: unknown, suite: Suite) {
    this.suite = suite;
  }

  onEnd(result: FullResult): { status: "failed" } | undefined {
    const tests = this.suite?.allTests() ?? [];
    const finalStatuses = tests.map((test) => test.results.at(-1)?.status ?? "skipped");
    const passed = finalStatuses.filter((status) => status === "passed").length;
    const skipped = finalStatuses.filter((status) => status === "skipped").length;
    const failed = finalStatuses.filter((status) => status !== "passed" && status !== "skipped").length;

    process.stdout.write(`production-smoke: passed=${passed} skipped=${skipped} failed=${failed}\n`);
    if (tests.length === 0 || passed === 0 || skipped > 0 || result.status !== "passed") {
      return { status: "failed" };
    }
  }
}

export default ProductionSmokeReporter;
