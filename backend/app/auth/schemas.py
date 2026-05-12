from uuid import UUID

from pydantic import BaseModel, EmailStr


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    tenant_name: str


class SignupResponse(BaseModel):
    message: str
    user_id: UUID
    tenant_id: UUID
    dev_verification_token: str | None = None


class VerifyEmailRequest(BaseModel):
    token: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    email: str
    tenant_id: UUID
    role: str


class MeResponse(BaseModel):
    user: UserResponse
    tenant_id: UUID
    tenant_name: str


class SessionProbeResponse(BaseModel):
    authenticated: bool
    user: UserResponse | None = None
    tenant_id: UUID | None = None
    tenant_name: str | None = None


class RefreshResponse(BaseModel):
    message: str


class PasswordResetRequestBody(BaseModel):
    email: EmailStr


class PasswordResetConfirmBody(BaseModel):
    token: str
    new_password: str


class MessageResponse(BaseModel):
    message: str
    dev_reset_token: str | None = None
