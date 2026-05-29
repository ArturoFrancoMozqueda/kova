# Claude Code Hooks for Kova

Markdown rules guide Claude, but they do not truly enforce safety. For Kova, the highest-value future hooks are:

## Secret protection

Block commands or edits that expose secrets, such as:

```bash
cat .env
printenv
env
grep -R "sk_live_" .
```

## Production deploy protection

Require explicit user approval before:

```bash
fly deploy
vercel --prod
supabase db push
supabase migration repair
```

## Billing safety

Require confirmation before edits touching Stripe, billing, subscriptions, checkout, webhooks, price IDs, or invoice events.

## Migration safety

Require confirmation before destructive or tenant-sensitive database operations.

## Test integrity

Warn when a change only modifies tests, snapshots, fixtures, or expected outputs after a failure.
