export type BookingService = {
  id: string;
  name: string;
  description: string;
  duration_minutes: number;
  resource_ids: string[];
  is_active: boolean;
  version: number;
};
export type BookingPage = {
  mode?: "appointments" | "tables";
  enabled: boolean;
  version: number;
  horizon_days: number;
  notice_minutes: number;
  slot_minutes: number;
  manage_cutoff_hours: number;
  share_path: string | null;
};
export type AvailabilityWindow = { start: string; end: string };
export type Availability = {
  version: number;
  resource_id: string;
  weekly: { weekday: number; windows: AvailabilityWindow[] }[];
  exceptions: { date: string; windows: AvailabilityWindow[] }[];
};
export type CalendarEvent = {
  id: string;
  source: "appointment" | "booking" | "table";
  title: string;
  resource_id: string | null;
  resource_name: string;
  timezone: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
  customer_id: string | null;
  customer_name: string;
  version: number;
};
export type BookingReceipt = {
  calendar_uid?: string;
  title: string;
  resource_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: string;
  version: number;
  can_manage: boolean;
  manage_path?: string;
};
export type Slot = { starts_at: string; ends_at: string; timezone: string };

export type TableStatus =
  | "requested"
  | "confirmed"
  | "seated"
  | "completed"
  | "declined"
  | "cancelled"
  | "no_show";
export type TableArrival = { starts_at: string; timezone: string };
export type TableReceipt = TableArrival & {
  title: string;
  party_size: number;
  resource_name: string | null;
  status: TableStatus;
  version: number;
  can_manage: boolean;
  calendar_uid: string;
  manage_path?: string | null;
};
export type TableReservation = TableReceipt & {
  id: string;
  name: string;
  phone: string;
  resource_id: string | null;
  customer_id: string | null;
  seated_at: string | null;
  released_at: string | null;
};
export type TableDetail = TableReservation & {
  history: {
    action: string;
    starts_at: string;
    status: TableStatus;
    created_at: string;
  }[];
};
