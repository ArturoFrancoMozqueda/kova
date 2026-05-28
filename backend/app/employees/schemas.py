from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr

EmployeeRole = Literal["owner", "manager", "cashier"]


class EmployeeResponse(BaseModel):
    membership_id: UUID
    user_id: UUID
    email: EmailStr
    role: str
    is_active: bool
    created_at: datetime


class EmployeeRoleUpdate(BaseModel):
    role: EmployeeRole


class InvitationCreate(BaseModel):
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


class InvitationAccept(BaseModel):
    token: str
    password: str | None = None
