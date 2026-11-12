export function releaseStatusClass(WorkerEntrypoint) {
  return class extends WorkerEntrypoint {
    getActiveSlot() {
      const slot = this.env.KOVA_NATIVE_ACTIVE_SLOT ?? "legacy";
      if (!["legacy", "blue", "green", "recovery"].includes(slot)) throw new Error("Invalid native gateway routing");
      return slot;
    }
  };
}
