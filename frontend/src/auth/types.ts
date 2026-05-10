export type SignupRequest = {
  email: string;
  password: string;
  tenant_name: string;
};

export type SignupResponse = {
  message: string;
  user_id: string;
  tenant_id: string;
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
