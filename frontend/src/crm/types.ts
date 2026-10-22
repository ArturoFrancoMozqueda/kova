export type OpportunityStage =
  | "new"
  | "contacted"
  | "proposal"
  | "won"
  | "lost";
export type Opportunity = {
  id: string;
  customer_id: string;
  customer_name: string;
  title: string;
  stage: OpportunityStage;
  estimated_amount: string;
  assigned_user_id: string | null;
  next_action: string | null;
  due_at: string | null;
  note: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};
export type ContactConsent = {
  id: string;
  customer_id: string;
  customer_name: string;
  contact_current: boolean;
  channel: "whatsapp" | "email";
  purpose: "transactional" | "marketing";
  enabled: boolean;
  source: "owner_recorded";
  version: number;
  updated_at: string;
};
export type CrmData = {
  opportunities: Opportunity[];
  consents: ContactConsent[];
  capabilities: { whatsapp: "not_connected"; email: "not_connected" };
  opportunities_has_more: boolean;
  consents_has_more: boolean;
};
