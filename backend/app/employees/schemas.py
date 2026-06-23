from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr

from app.shared.validation import StrictModel

EmployeeRole = Literal["owner", "manager", "cashier"]


class EmployeeResponse(BaseModel):
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
