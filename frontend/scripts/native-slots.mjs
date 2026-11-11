export const SLOT_WORKERS = Object.freeze({
  blue: "kova-api-blue",
  green: "kova-api-green",
});
export const SLOT_APPLICATIONS = Object.freeze({ blue: "kova-api-blue", green: "kova-api-green" });
export const LEGACY_WORKER = "kova-backend";
export const SLOT_DRAIN_MS = 300_000;

export function slotWorker(slot) {
  if (slot === "legacy") return LEGACY_WORKER;
  if (!Object.hasOwn(SLOT_WORKERS, slot)) throw new Error("Invalid native API slot");
  return SLOT_WORKERS[slot];
}

export function nextSlot(active) {
  slotWorker(active);
  return active === "green" ? "blue" : "green";
}
