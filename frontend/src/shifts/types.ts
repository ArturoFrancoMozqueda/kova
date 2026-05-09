export type CashMovement = {
  id: string;
  shift_id: string;
  type: "opening_balance" | "cash_in" | "cash_out";
  amount: string;
  reason: string;
  created_at: string;
};

export type Shift = {
  id: string;
  tenant_id: string;
  status: "open" | "closed";
  opening_cash_amount: string | null;
  actual_cash_amount: string | null;
  expected_cash_amount: string | null;
  reconciliation_status: "balanced" | "overage" | "shortage" | null;
  variance_amount: string | null;
  opened_at: string;
  closed_at: string | null;
  movements: CashMovement[];
};

export type ShiftOpenPayload = {
  opening_cash_amount?: string;
};

export type ShiftClosePayload = {
  actual_cash_amount: string;
};

export type CashMovementPayload = {
  type: "cash_in" | "cash_out";
  amount: string;
  reason: string;
};
