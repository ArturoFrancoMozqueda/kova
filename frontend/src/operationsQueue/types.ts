export type OperationsQueueSource =
  | "service_cases"
  | "opportunities"
  | "followups"
  | "appointment_reminders";
export type OperationsQueueItem = {
  source_id: string;
  title: string;
  customer_name: string;
  state: string;
  version: number;
  due_at: string | null;
  overdue: boolean;
  route_key: "service_cases" | "crm" | "followups" | "appointments";
};
export type OperationsQueueSection = {
  source: OperationsQueueSource;
  items: OperationsQueueItem[];
  has_more: boolean;
};
export type OperationsQueueData = {
  generated_at: string;
  sections: OperationsQueueSection[];
};
