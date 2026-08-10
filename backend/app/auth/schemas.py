import re
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.shared.validation import StrictModel, reject_html

_PASSWORD_MIN_LENGTH = 8
_PASSWORD_MAX_LENGTH = 128


def _validate_password_strength(value: str) -> str:
    if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
        raise ValueError("La contraseña debe incluir letras y números")
    return value


def _normalize_email(value: str) -> str:
    """Trim and lowercase so the same address can't create distinct accounts and
    login/reset/enumeration checks all compare against one canonical form."""
    return value.strip().lower()


class SignupRequest(StrictModel):
    email: EmailStr
    password: str = Field(min_length=_PASSWORD_MIN_LENGTH, max_length=_PASSWORD_MAX_LENGTH)
    tenant_name: str = Field(min_length=1, max_length=120)
    accepted_terms: bool = False

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        return _normalize_email(v)

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)

    @field_validator("tenant_name")
    @classmethod
    def _tenant_name_no_html(cls, v: str) -> str:
        return reject_html(v) or v


class SignupResponse(BaseModel):
    message: str
    reason: str
    user_id: UUID | None = None
    tenant_id: UUID | None = None
    dev_verification_token: str | None = None


class VerifyEmailRequest(StrictModel):
    token: str


class LoginRequest(StrictModel):
    email: EmailStr
    password: str

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        return _normalize_email(v)


class UserResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    email: str
    tenant_id: UUID
    role: str
    # Unverified accounts can now sign in and use the product, so the client
    # needs to know in order to show the verification banner and disable paid
    # actions before the server has to reject them.
    email_verified: bool = True


class MeResponse(BaseModel):
    user: UserResponse
    tenant_id: UUID
    tenant_name: str
    feature_flags: dict[str, bool]


class SessionProbeResponse(BaseModel):
    authenticated: bool
    user: UserResponse | None = None
    tenant_id: UUID | None = None
    tenant_name: str | None = None
    feature_flags: dict[str, bool] | None = None


class RefreshResponse(BaseModel):
    message: str


class PasswordResetRequestBody(StrictModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        return _normalize_email(v)


class PasswordResetConfirmBody(StrictModel):
    token: str
    new_password: str = Field(min_length=_PASSWORD_MIN_LENGTH, max_length=_PASSWORD_MAX_LENGTH)

    @field_validator("new_password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


class MessageResponse(BaseModel):
    message: str
    dev_reset_token: str | None = None
