export type AppointmentResource = {
  id: string;
  name: string;
  timezone: string;
  is_active: boolean;
  version: number;
};
export type AppointmentSale = {
  id: string;
  status: "completed" | "voided";
  total_amount: string;
  refunded_amount: string;
  created_at: string;
};
export type Appointment = {
  sale?: AppointmentSale | null;
  id: string;
  resource_id: string;
  resource_name: string;
  timezone: string;
  customer_id: string;
  customer_name: string;
  title: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
  status: "scheduled" | "cancelled" | "completed" | "no_show";
  version: number;
  created_at: string;
  updated_at: string;
};
export type AppointmentPage = { items: Appointment[]; has_more: boolean };
