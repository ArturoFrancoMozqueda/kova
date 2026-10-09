from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, field_validator

from app.shared.validation import StrictModel, validate_password_byte_length

EmployeeRole = Literal["owner", "manager", "cashier"]


class EmployeeResponse(BaseModel):
    allowed_branch_id: UUID | None = None
    membership_id: UUID
    user_id: UUID
    email: EmailStr
    role: str
    is_active: bool
    created_at: datetime


class EmployeeRoleUpdate(StrictModel):
    role: EmployeeRole


class InvitationCreate(StrictModel):
    email: EmailStr
    role: EmployeeRole


class InvitationResponse(BaseModel):
    id: UUID
    email: EmailStr
    role: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class InvitationPreview(BaseModel):
    email: EmailStr
    role: str
    tenant_name: str
    requires_password: bool


class InvitationAccept(StrictModel):
    token: str
    password: str | None = None

    @field_validator("password")
    @classmethod
    def _password_byte_length(cls, value: str | None) -> str | None:
        return validate_password_byte_length(value) if value is not None else None


class EmployeeBranchUpdate(StrictModel):
    allowed_branch_id: UUID | None
