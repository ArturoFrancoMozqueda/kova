import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  Bike,
  CalendarClock,
  Crown,
  CheckCheck,
  CheckCircle2,
  CircleDashed,
  CircleDollarSign,
  Clock,
  ClockAlert,
  CookingPot,
  HandCoins,
  Lock,
  PackageCheck,
  PackageOpen,
  PackageX,
  ShieldCheck,
  Sparkles,
  Store,
  Truck,
  Undo2,
  Unlock,
  UserRound,
  UserX,
  XCircle,
} from "lucide-react";

export type SemanticTone = "neutral" | "info" | "success" | "warning" | "danger";
export type SemanticEntry = { icon: LucideIcon; tone: SemanticTone };

/**
 * One icon and tone per business concept, so the same state looks the same in
 * every screen. Labels stay with each domain's copy; the icon never replaces
 * the text. Keep "pedido" progress and "cobro" status in separate groups: an
 * order can be delivered and still unpaid.
 */
export const semanticIcons = {
  customerOrderStatus: {
    new: { icon: Sparkles, tone: "info" },
    confirmed: { icon: CheckCircle2, tone: "info" },
    in_progress: { icon: CookingPot, tone: "info" },
    ready: { icon: PackageCheck, tone: "success" },
    fulfilled: { icon: CheckCheck, tone: "success" },
    cancelled: { icon: XCircle, tone: "danger" },
  },
  customerOrderPayment: {
    unpaid: { icon: HandCoins, tone: "warning" },
    paid: { icon: CircleDollarSign, tone: "success" },
    partially_refunded: { icon: Undo2, tone: "warning" },
    refunded: { icon: Undo2, tone: "neutral" },
    voided: { icon: Ban, tone: "danger" },
  },
  fulfillment: {
    pickup: { icon: Store, tone: "neutral" },
    delivery: { icon: Bike, tone: "neutral" },
  },
  sale: {
    completed: { icon: CheckCircle2, tone: "success" },
    voided: { icon: Ban, tone: "danger" },
  },
  refund: {
    partial: { icon: Undo2, tone: "warning" },
    full: { icon: Undo2, tone: "danger" },
  },
  shift: {
    open: { icon: Unlock, tone: "success" },
    closed: { icon: Lock, tone: "neutral" },
  },
  reconciliation: {
    balanced: { icon: CheckCircle2, tone: "success" },
    overage: { icon: ArrowUpRight, tone: "warning" },
    shortage: { icon: ArrowDownRight, tone: "warning" },
  },
  stock: {
    low: { icon: AlertTriangle, tone: "warning" },
    out: { icon: PackageX, tone: "danger" },
  },
  appointment: {
    scheduled: { icon: CalendarClock, tone: "info" },
    completed: { icon: CheckCircle2, tone: "success" },
    no_show: { icon: UserX, tone: "warning" },
    cancelled: { icon: XCircle, tone: "neutral" },
  },
  purchase: {
    pending: { icon: Truck, tone: "info" },
    partial: { icon: PackageOpen, tone: "warning" },
    received: { icon: PackageCheck, tone: "success" },
    cancelled: { icon: XCircle, tone: "neutral" },
  },
  role: {
    owner: { icon: Crown, tone: "info" },
    manager: { icon: ShieldCheck, tone: "info" },
    cashier: { icon: UserRound, tone: "neutral" },
    staff: { icon: UserRound, tone: "neutral" },
  },
  attention: {
    overdue: { icon: ClockAlert, tone: "warning" },
    scheduled: { icon: Clock, tone: "neutral" },
    stock_conflict: { icon: AlertTriangle, tone: "warning" },
  },
} satisfies Record<string, Record<string, SemanticEntry>>;

export type SemanticDomain = keyof typeof semanticIcons;

const fallback: SemanticEntry = { icon: CircleDashed, tone: "neutral" };

/** Icon for a value; unknown values fall back to a neutral icon, never to a raw code. */
export function semanticIcon(domain: SemanticDomain, value: string | null | undefined): SemanticEntry {
  const entries = semanticIcons[domain] as Record<string, SemanticEntry>;
  return (value != null && Object.prototype.hasOwnProperty.call(entries, value) ? entries[value] : undefined) ?? fallback;
}
