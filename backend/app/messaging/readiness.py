"""Read-only setup guidance, never an inference from global credentials or contact data."""

from typing import Literal

from pydantic import BaseModel, Field


class SetupItem(BaseModel):
    key: str
    title: str
    description: str
    status: Literal["required", "review_required"]


class MessagingReadiness(BaseModel):
    provider: Literal["whatsapp_cloud_api"] = "whatsapp_cloud_api"
    status: Literal["not_connected", "connected", "configuration_error"] = "not_connected"
    setup_status: Literal["setup_required", "configured"] = "setup_required"
    account_mode: Literal["not_verified", "verified"] = "not_verified"
    business_app_implies_cloud_api: bool = False
    send_enabled: bool = False
    webhook_enabled: bool = False
    tenant_mapping_verified: bool = False
    supported_message_types: list[str] = Field(default_factory=lambda: ["text", "template"])
    checklist: list[SetupItem]


def readiness() -> MessagingReadiness:
    # This endpoint does not inspect or reveal secrets, account IDs or setup of other tenants.
    return MessagingReadiness(
        checklist=[
            SetupItem(
                key="account_mode",
                title="Revisa cómo usas WhatsApp",
                description=(
                    "Cuéntanos si ya atiendes por WhatsApp Business. El equipo de Kova "
                    "te ayudará a revisar qué necesitas para usarlo desde la bandeja."
                ),
                status="required",
            ),
            SetupItem(
                key="coexistence",
                title="Revisa cómo conservar tu app y número",
                description=(
                    "Revisaremos contigo si puedes conservar tu app y tu número. "
                    "Mantén tu cuenta actual hasta que el equipo confirme los pasos."
                ),
                status="review_required",
            ),
            SetupItem(
                key="business_assets",
                title="Confirma el número de tu negocio",
                description=(
                    "Ten a la mano el número que usarás para atender clientes y acceso a "
                    "la cuenta empresarial que lo administra. Kova revisará su autorización "
                    "con Meta."
                ),
                status="required",
            ),
            SetupItem(
                key="app_permissions",
                title="Autoriza la conexión con Meta",
                description=(
                    "El equipo de Kova te acompañará a revisar las autorizaciones necesarias. "
                    "No compartas contraseñas ni claves por mensajes."
                ),
                status="review_required",
            ),
            SetupItem(
                key="tenant_binding",
                title="Elige la sucursal que atenderá",
                description=(
                    "Confirma a qué sucursal pertenece el número para que los mensajes "
                    "lleguen al equipo correcto. La conexión se revisa para cada negocio."
                ),
                status="required",
            ),
            SetupItem(
                key="webhooks",
                title="Comprueba que los mensajes lleguen",
                description=(
                    "Antes de comenzar, verificaremos la recepción y la entrega con un "
                    "contacto autorizado. La bandeja distinguirá los mensajes enviados "
                    "de los entregados."
                ),
                status="required",
            ),
            SetupItem(
                key="consent_templates",
                title="Revisa a quién puedes contactar",
                description=(
                    "Cada cliente decide si quiere recibir mensajes. Revisaremos sus permisos, "
                    "los tipos de aviso autorizados y cómo dejar de recibirlos."
                ),
                status="required",
            ),
            SetupItem(
                key="controlled_acceptance",
                title="Confirma costos antes de comenzar",
                description=(
                    "Consulta las tarifas y los límites aplicables con el equipo. "
                    "La activación se realiza después de confirmar contigo la entrega de mensajes."
                ),
                status="review_required",
            ),
        ]
    )
