export type SignupRequest = {
  email: string;
  password: string;
  tenant_name: string;
  accepted_terms: boolean;
};

export type SignupReason =
  | "account_created"
  | "verification_resent"
  | "email_in_use";

export type SignupResponse = {
  message: string;
  reason: SignupReason;
  user_id: string | null;
  tenant_id: string | null;
  dev_verification_token: string | null;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type MessageResponse = {
  message: string;
  dev_reset_token?: string | null;
};

export type MeResponse = {
  user: {
    id: string;
    email: string;
    tenant_id: string;
    role: string;
  };
  tenant_id: string;
  tenant_name: string;
};

export type SessionProbeResponse =
  | { authenticated: false; user?: null; tenant_id?: null; tenant_name?: null }
  | {
      authenticated: true;
      user: MeResponse["user"];
      tenant_id: string;
      tenant_name: string;
    };
