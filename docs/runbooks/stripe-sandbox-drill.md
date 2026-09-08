# KOV-005 Stripe Sandbox drill

This runbook closes the external evidence gate for KOV-005. It operates only in Stripe test mode
against an application and PostgreSQL database created inside a GitHub-hosted runner. It never
deploys Kova, contacts the production API, or mutates the production database.

## GitHub environment

Create a GitHub environment named exactly `stripe-sandbox` and add only these values:

| Kind | Name | Requirement |
|---|---|---|
| Secret | `KOV005_STRIPE_SECRET_KEY` | `sk_test_…` or `rk_test_…`. A restricted key needs read/write access to Checkout Sessions, Customers, Payment Methods, Subscriptions, Invoices, Events and Test Clocks, plus read access to Account and Prices. |
| Secret | `KOV005_STRIPE_STANDARD_PRICE_ID` | Active test-mode recurring Price for exactly MXN 299.00 monthly. |
| Variable | `KOV005_STRIPE_ACCOUNT_ID` | Exact `acct_…` identifier of the dedicated Sandbox. It is compared with `/v1/account` before mutations. |

Do not copy production Stripe secrets into this environment. No database, webhook, application,
email, Fly or Vercel secret is required. The workflow creates ephemeral PostgreSQL, application and
webhook signing secrets and deletes the test clocks and standalone Checkout customer before it can
pass.

The workflow itself accepts only `main`, requires the exact acknowledgement, rejects live keys,
checks the exact Sandbox account and Price, and keeps the application and database on runner
loopback. If the repository plan supports environment protection rules, also restrict the
environment to `main` and require a reviewer. The current private-repository plan returned HTTP 422
when those protection rules were configured, so they are an optional defense and must not be
described as active unless GitHub shows them on the environment.

## Run

1. Merge the runner into `main` and select **Actions → KOV-005 Stripe sandbox drill**.
2. Choose `main` and enter the acknowledgement exactly as
   `KOV-005-STRIPE-SANDBOX-ONLY`.
3. Before dispatch, check that the key and account belong to the dedicated Sandbox. If environment
   reviewers are configured, approve the deployment after that check.
4. Download `kov-005-stripe-sandbox-<sha>` only after the workflow succeeds.
5. Review the Markdown artifact. Commit it under
   `docs/audits/evidence/KOV-005-STRIPE-TEST-MODE-DRILL-YYYY-MM-DD.md` without adding screenshots,
   raw exports or secrets.
6. After the evidence is committed, delete `KOV005_STRIPE_SECRET_KEY` from the GitHub environment.
   Repeating the drill requires an explicit new installation of a sandbox key.

The drill proves hosted Checkout, renewal, payment failure and grace, payment recovery, scheduled
cancellation, period-end cancellation, both cross-family arrival orders and duplicate delivery. The
cross-family cases use provider-generated `livemode=false` events retrieved from Stripe and send
them through Kova's real webhook route with a valid ephemeral signature in controlled order.

## Required evidence

The artifact must contain the tested commit SHA, `livemode=false`, the redacted Sandbox account and
Price, event creation and arrival timestamps, local subscription state, lifecycle and payment
watermarks, access outcome, duplicate outcome and successful cleanup counts. Stripe identifiers
must remain redacted to their prefix and final six characters.

The gate remains open if the job is skipped, fails, cannot delete every created Test Clock/customer,
uses a commit other than the intended `main` SHA, or lacks the downloaded and reviewed artifact.
