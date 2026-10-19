"""Request-local platform bindings; never place a tenant/session in global state."""

from contextvars import ContextVar

environment = ContextVar("kova_workers_environment", default=None)
execution = ContextVar("kova_workers_execution", default=None)
