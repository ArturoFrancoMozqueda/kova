import { calculateSalePricing } from "./pricing";

/** A line of the bill: its key, units and unit price in cents. */
export type BillLine = { key: string; quantity: number; unitCents: number };

/** Person (0-based) of every unit, per line key. Missing units belong to the first person. */
export type SplitAssignment = Record<string, number[]>;

export type SplitPart = { key: string; person: number; quantity: number };

export const MIN_PEOPLE = 2;
export const MAX_PEOPLE = 8;

/** Who has each unit, completing or trimming to the line's current quantity. */
export function unitsOf(line: BillLine, assignment: SplitAssignment, people: number): number[] {
  const current = assignment[line.key] ?? [];
  return Array.from({ length: line.quantity }, (_, unit) => {
    const person = current[unit] ?? 0;
    return person < people ? person : 0;
  });
}

/** One sale line per (cart line, person) in cart order, the order the server prices them. */
export function splitParts(lines: BillLine[], assignment: SplitAssignment, people: number): SplitPart[] {
  const parts: SplitPart[] = [];
  for (const line of lines) {
    const units = unitsOf(line, assignment, people);
    for (let person = 0; person < people; person += 1) {
      const quantity = units.filter((owner) => owner === person).length;
      if (quantity > 0) parts.push({ key: line.key, person, quantity });
    }
  }
  return parts;
}

/**
 * What each person pays: the sale priced over the split lines exactly as the
 * server does (discount and tax shared by line, cumulative rounding).
 */
export function personTotals(
  lines: BillLine[],
  assignment: SplitAssignment,
  people: number,
  discount: string,
  taxRate: string,
): { parts: SplitPart[]; allocated: number[]; totals: number[]; valid: boolean } {
  const parts = splitParts(lines, assignment, people);
  const unitCents = new Map(lines.map((line) => [line.key, line.unitCents]));
  const pricing = calculateSalePricing(
    parts.map((part) => (unitCents.get(part.key) ?? 0) * part.quantity), discount, taxRate,
  );
  const totals = Array.from({ length: people }, () => 0);
  parts.forEach((part, index) => { totals[part.person] += pricing.allocated[index] ?? 0; });
  return { parts, allocated: pricing.allocated, totals, valid: pricing.valid };
}

/** Cumulative rounding of a fixed line total by units, as the server splits a pedido line. */
export function portionCents(lineTotalCents: number, quantity: number, taken: number, units: number): number {
  const share = (count: number) => Math.floor((2 * lineTotalCents * count + quantity) / (2 * quantity));
  return share(taken + units) - share(taken);
}

/** Share a credit (a pedido deposit) by each person's total, as the server allocates it. */
export function shareCredit(totals: number[], creditCents: number): number[] {
  const denominator = totals.reduce((sum, value) => sum + value, 0);
  let cumulative = 0;
  let previous = 0;
  return totals.map((total) => {
    cumulative += total;
    const current = denominator ? Math.floor((2 * creditCents * cumulative + denominator) / (2 * denominator)) : 0;
    const value = current - previous;
    previous = current;
    return value;
  });
}

/**
 * A pedido split by person: each item's fixed total shared by units (people in
 * order), minus each person's share of the deposit already collected.
 */
export function pedidoPersonDue(
  items: { key: string; quantity: number; lineTotalCents: number }[],
  assignment: SplitAssignment,
  people: number,
  depositCents: number,
): { owed: number[]; credits: number[]; due: number[]; groups: { key: string; person: number; quantity: number }[] } {
  const owed = Array.from({ length: people }, () => 0);
  const groups: { key: string; person: number; quantity: number }[] = [];
  for (const item of items) {
    const units = unitsOf({ key: item.key, quantity: item.quantity, unitCents: 0 }, assignment, people);
    let taken = 0;
    for (let person = 0; person < people; person += 1) {
      const quantity = units.filter((owner) => owner === person).length;
      if (!quantity) continue;
      owed[person] += portionCents(item.lineTotalCents, item.quantity, taken, quantity);
      groups.push({ key: item.key, person, quantity });
      taken += quantity;
    }
  }
  const credits = shareCredit(owed, depositCents);
  return { owed, credits, due: owed.map((value, person) => value - credits[person]), groups };
}
