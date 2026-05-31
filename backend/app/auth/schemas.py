import re
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator

_PASSWORD_MIN_LENGTH = 8
_PASSWORD_MAX_LENGTH = 128


def _validate_password_strength(value: str) -> str:
    if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
        raise ValueError("La contraseña debe incluir letras y números")
    return value


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=_PASSWORD_MIN_LENGTH, max_length=_PASSWORD_MAX_LENGTH)
    tenant_name: str
    accepted_terms: bool = False

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


class SignupResponse(BaseModel):
    message: str
    reason: str
    user_id: UUID | None = None
    tenant_id: UUID | None = None
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
    new_password: str = Field(min_length=_PASSWORD_MIN_LENGTH, max_length=_PASSWORD_MAX_LENGTH)

    @field_validator("new_password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


class MessageResponse(BaseModel):
    message: str
    dev_reset_token: str | None = None
