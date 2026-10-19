# Retired Fly integration

The owner permanently retired Fly on 2026-10-19 after Cloudflare acceptance.
These `.txt` files are historical source, not executable deployment instructions.
Do not reactivate or restore them. Application machines and IP allocations were
removed; Supabase and Cloudflare remain authoritative.

The old manual recovery drill created Fly/Vercel fixtures and cannot run after
retirement. Its Fly-specific provisioning/cleanup tests are archived with it.
Current CI still requires publication/recovery contracts for exact Cloudflare
versions, candidate/promotion/acceptance failures, frontend/backend readiness,
secrets protection and strict public identity verification. The repository gate
rejects active workflows referencing the retired CLI or credentials.

Production recovery stays in `frontend/scripts/release-recovery.mjs` and the two
Cloudflare providers. Existing Fly-only rollback artifacts are intentionally no
longer usable. This retirement does not claim a new remote Vercel drill or settle
past provider invoices.
