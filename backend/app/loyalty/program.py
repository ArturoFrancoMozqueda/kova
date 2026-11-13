"""Atomic program editing. Existing revision endpoints remain compatible."""

from pydantic import BaseModel, Field

from app.audit import service as audit
from app.branches.scope import active_branch_id
from app.business_settings.models import BusinessProfile, ReceiptSettings
from app.idempotency import service as idempotency
from app.loyalty import enrollment, rewards, service
from app.loyalty.models import (
    LoyaltyAppearance,
    LoyaltyEnrollmentPolicy,
    LoyaltyPolicyRevision,
    LoyaltyRewardRevision,
)
from app.loyalty.schemas import (
    EnrollmentPolicyResponse,
    EnrollmentPolicyWrite,
    LoyaltyAppearanceResponse,
    LoyaltyPolicyResponse,
    LoyaltyPolicyWrite,
    LoyaltyRewardResponse,
    LoyaltyRewardWrite,
)
from app.shared.exceptions import conflict
from app.shared.validation import StrictModel
from app.tenants.models import Tenant


class AppearanceWrite(StrictModel):
    color: str = Field(default="#0F1117", pattern=r"^#[0-9a-fA-F]{6}$")
    use_business_logo: bool = True
    expected_version: int = Field(ge=0)


class ProgramWrite(StrictModel):
    policy: LoyaltyPolicyWrite
    reward: LoyaltyRewardWrite | None = None
    reward_expected_version: int = Field(ge=0)
    enrollment: EnrollmentPolicyWrite
    appearance: AppearanceWrite


class ProgramResponse(BaseModel):
    business_name: str
    appearance: LoyaltyAppearanceResponse
    policy: LoyaltyPolicyResponse
    reward: LoyaltyRewardResponse | None
    enrollment: EnrollmentPolicyResponse


def appearance(db, tenant):
    row = (
        db.query(LoyaltyAppearance)
        .filter_by(tenant_id=tenant, branch_id=active_branch_id(db, tenant))
        .first()
    )
    receipt = db.query(ReceiptSettings).filter_by(tenant_id=tenant).first()
    # Only the first-party, validated upload is exposed, never an arbitrary settings URL.
    logo = (
        receipt.logo_url
        if receipt
        and receipt.logo_url
        and receipt.logo_url.startswith(f"/api/v1/settings/receipt/logo/{tenant}?")
        else None
    )
    return LoyaltyAppearanceResponse(
        color=row.color if row else "#0F1117",
        use_business_logo=row.use_business_logo if row else True,
        version=row.version if row else 0,
        logo_url=logo,
    ).model_dump()


def read(db, tenant):
    profile = db.query(BusinessProfile).filter_by(tenant_id=tenant).first()
    business = db.query(Tenant).filter_by(id=tenant).one()
    return {
        "business_name": profile.public_name if profile else business.name,
        "policy": service._policy_response(service._latest(db, tenant)),
        "reward": rewards.describe(rewards.latest(db, tenant)),
        "enrollment": enrollment.policy(db, tenant).model_dump(),
        "appearance": appearance(db, tenant),
    }


def save(db, tenant, actor, body, key):
    branch = service._lock(db, tenant)
    digest, replay = service._claim(db, tenant, key, "program", body)
    if replay:
        return replay.response_status, replay.response_body
    current = read(db, tenant)
    if (
        body.policy.expected_version != current["policy"]["version"]
        or body.enrollment.expected_version != current["enrollment"]["version"]
        or body.appearance.expected_version != current["appearance"]["version"]
        or body.reward_expected_version
        != (current["reward"]["version"] if current["reward"] else 0)
        or (body.reward and body.reward.expected_version != body.reward_expected_version)
    ):
        raise conflict("El programa cambió. Consulta su configuración antes de guardar.")
    db.add(
        LoyaltyPolicyRevision(
            tenant_id=tenant,
            branch_id=branch,
            authorized_by_user_id=actor,
            version=body.policy.expected_version + 1,
            **body.policy.model_dump(exclude={"expected_version"}),
        )
    )
    db.add(
        LoyaltyEnrollmentPolicy(
            tenant_id=tenant,
            branch_id=branch,
            authorized_by_user_id=actor,
            version=body.enrollment.expected_version + 1,
            enabled=body.enrollment.enabled,
        )
    )
    if body.reward:
        db.add(
            LoyaltyRewardRevision(
                tenant_id=tenant,
                branch_id=branch,
                authorized_by_user_id=actor,
                version=body.reward.expected_version + 1,
                **body.reward.model_dump(exclude={"expected_version"}),
            )
        )
    elif current["reward"]:
        old = current["reward"]
        db.add(
            LoyaltyRewardRevision(
                tenant_id=tenant,
                branch_id=branch,
                authorized_by_user_id=actor,
                version=old["version"] + 1,
                enabled=False,
                title=old["title"],
                points_cost=old["points_cost"],
                discount_amount=old["discount_amount"],
            )
        )
    design = db.query(LoyaltyAppearance).filter_by(tenant_id=tenant, branch_id=branch).first()
    if design is None:
        design = LoyaltyAppearance(tenant_id=tenant, branch_id=branch, version=0)
        db.add(design)
    design.color = body.appearance.color.upper()
    design.use_business_logo = body.appearance.use_business_logo
    design.version += 1
    db.flush()
    result = read(db, tenant)
    audit.log(
        db,
        tenant_id=tenant,
        user_id=actor,
        action="loyalty.program",
        resource_type="loyalty_appearances",
        resource_id=design.id,
        changes={"version": design.version},
    )
    idempotency.store(
        db,
        tenant_id=tenant,
        key=key,
        request_hash=digest,
        response_status=200,
        response_body=result,
    )
    db.commit()
    return 200, result
