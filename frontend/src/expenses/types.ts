export type ExpenseCategory =
  | "renta"
  | "nomina"
  | "servicios"
  | "transporte"
  | "mantenimiento"
  | "marketing"
  | "comisiones"
  | "impuestos"
  | "otro";

export type Expense = {
  id: string;
  category: ExpenseCategory;
  amount: string;
  expense_date: string;
  note: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ExpensePayload = {
  category: ExpenseCategory;
  amount: string;
  expense_date: string;
  note: string | null;
};
