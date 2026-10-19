export type AutomationRule = {
  template_key: string;
  title: string;
  description: string;
  enabled: boolean;
  version: number;
};
export type AutomationRun = {
  id: string;
  template_key: string;
  title: string;
  status: "pending" | "completed" | "dismissed" | "suppressed";
  entity_id: string;
  entity_type: "customer_order" | "product" | "service_case";
  entity_version: number;
  version: number;
  created_at: string;
  resolved_at: string | null;
};
export type AutomationsData = {
  rules: AutomationRule[];
  runs: AutomationRun[];
  capabilities: {
    internal_tasks: boolean;
    external_messaging: boolean;
    financial_actions: boolean;
  };
};
