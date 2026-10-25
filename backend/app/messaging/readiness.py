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
                title="Distingue la app de la plataforma",
                description=(
                    "Usar WhatsApp Business en el celular o tener Meta Business no confirma "
                    "acceso a Cloud API."
                ),
                status="required",
            ),
            SetupItem(
                key="coexistence",
                title="Revisa cómo conservar tu app y número",
                description=(
                    "La elegibilidad y el flujo oficial de coexistencia requieren revisión. "
                    "No borres tu cuenta ni migres el número desde esta preparación."
                ),
                status="review_required",
            ),
            SetupItem(
                key="business_assets",
                title="Verifica la cuenta y el número de Cloud API",
                description=(
                    "Confirma la WABA, el Phone Number ID y la autorización de Meta para este "
                    "negocio; un número de teléfono no sustituye esos identificadores."
                ),
                status="required",
            ),
            SetupItem(
                key="app_permissions",
                title="Revisa aplicación, permisos y versión",
                description=(
                    "La aplicación y sus permisos de mensajería deben estar aprobados para el "
                    "alcance elegido, con versión Graph explícita y credenciales sólo del "
                    "servidor."
                ),
                status="review_required",
            ),
            SetupItem(
                key="tenant_binding",
                title="Vincula el canal al negocio correcto",
                description=(
                    "Antes de activar, Kova debe verificar una vinculación exclusiva entre "
                    "negocio, WABA y Phone Number ID; las credenciales de un negocio no se "
                    "comparten con otro."
                ),
                status="required",
            ),
            SetupItem(
                key="webhooks",
                title="Valida recepción y estados de entrega",
                description=(
                    "Se requiere callback HTTPS, verificación de firma, control de eventos "
                    "repetidos y conciliación de respuestas inciertas. Aceptado no significa "
                    "entregado."
                ),
                status="required",
            ),
            SetupItem(
                key="consent_templates",
                title="Confirma permisos y plantillas",
                description=(
                    "Registrar el teléfono no autoriza mensajes. Revisa consentimiento por "
                    "finalidad, bajas, ventana de atención, plantillas aprobadas y atención "
                    "humana."
                ),
                status="required",
            ),
            SetupItem(
                key="controlled_acceptance",
                title="Revisa costos y prueba antes de activar",
                description=(
                    "Confirma tarifas vigentes y límites, prueba con destinatarios "
                    "autorizados y verifica entrega real antes de habilitar automatizaciones."
                ),
                status="review_required",
            ),
        ]
    )
