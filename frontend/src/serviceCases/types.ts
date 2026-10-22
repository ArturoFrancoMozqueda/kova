export type ServiceCaseStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "reopened"
  | "cancelled";
export type ServiceCase = {
  id: string;
  customer_id: string;
  customer_name: string;
  title: string;
  status: ServiceCaseStatus;
  assigned_user_id: string | null;
  assignee_active: boolean;
  due_at: string | null;
  overdue: boolean;
  version: number;
  sale_order_id: string | null;
  customer_order_id: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};
export type ServiceCasePage = { items: ServiceCase[]; has_more: boolean };
export type ServiceCaseAssignee = {
  user_id: string;
  email: string;
  role: string;
};
export type ServiceCaseEvent = {
  id: string;
  case_id: string;
  case_version: number;
  kind: "created" | "updated" | "note_added";
  actor_user_id: string;
  status: ServiceCaseStatus;
  assigned_user_id: string | null;
  due_at: string | null;
  note: string | null;
  created_at: string;
};
export const serviceCaseStatuses: Record<ServiceCaseStatus, string> = {
  open: "Abierta",
  in_progress: "En atención",
  resolved: "Resuelta",
  reopened: "Reabierta",
  cancelled: "Cancelada",
};
