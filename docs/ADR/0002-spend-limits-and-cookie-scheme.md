# ADR 0002 — Spend limits, and cookie security follows the scheme

Status: accepted · 2026-07-30

Two decisions that were both made while hardening, and both come down to the same
principle: a control that is technically present but wrong in the environment it
runs in is worse than no control, because it looks like protection.

---

## 1. The spend limit stops automation, not the operator

### Context

`run.cost_micros` records what every run cost, and a `automation.monthly_budget_micros`
setting existed from Phase 1 — read in one place, with a hardcoded `$100` default,
its own idea of when a month starts, and no relationship to what the UI displayed.
A limit that is checked in one code path and displayed from another is a limit that
will eventually disagree with itself, and the operator will believe the screen.

Meanwhile the real risk is specific: an agent company that plans its own work can
change how much it spends without anyone deciding to. A weekly brief that starts
costing five times what it did last month does not announce itself; it announces
itself on a card statement.

### Decision

One implementation — `workspaces.budget()` — read by the kernel, the workflow
layer, and the dashboard. Pure logic (`budgetStatus`, thresholds, formatting) lives
in `@nexusai/core` with no I/O and is unit-tested; the repository function supplies
the two numbers.

Enforcement is **asymmetric, deliberately**:

- **Autonomous runs refuse to start** at or over the limit, checked at the head of
  the run beside the pause switch — so nothing is half-done.
- **Interactive chat continues.** The agent is _told_ it is over budget so it can
  keep answers short and say why, but it still answers.

Three smaller choices inside that:

- `>=`, not `>`. A $50 limit means $50 has been spent.
- `null` means unlimited; `0` means "no autonomous spending". Distinct states, both
  wanted, and conflating them would make an empty field stop the company.
- A malformed setting is read as unset, not as zero. A typo in a JSON column must
  not halt everything.

### Why chat is exempt

Locking the operator out of their own company because a cron job overspent punishes
the only person who can decide what to do about it. They cannot raise the limit,
cancel the schedule, or judge whether the spend was worth it without being able to
ask. The limit is a brake on automation, not a cap on the account — which is stated
in the code, in the UI, and here, because a reader who assumes otherwise will
eventually "fix" it.

### Consequences

- The bill can exceed the limit through interactive use. That is the trade, and the
  dashboard shows spend against limit continuously rather than only when blocked.
- Failed runs count toward spend. A run that died halfway still burned tokens, and
  a budget that only counted successes would understate exactly the number the
  operator most wants.
- `remainingBudgetMicros` returns `Infinity` when unlimited, so `remaining > 0` is
  correct in every case rather than only when a limit exists.

---

## 2. `useSecureCookies` follows the URL scheme, not `NODE_ENV`

### Context

The conventional configuration is `useSecureCookies: process.env.NODE_ENV === 'production'`,
and it was what this app did. It is wrong here, and the failure is silent:

`next start` sets `NODE_ENV=production`. This deployment serves plain HTTP on
localhost — that is the whole point of the local-only revision in ADR 0001. So the
session cookie was issued as `__Secure-nexus.session_token; Secure`, the browser
discarded it (a `__Secure-` cookie is only accepted over TLS), the app navigated to
the dashboard, the proxy found no cookie, and it redirected back to sign-in with
**nothing on screen to explain why**. The server logs a 200. The database has a
valid session. Everything looks fine.

Two adjacent bugs had the same shape:

- The browser auth client hardcoded `NEXT_PUBLIC_APP_URL ?? 'http://localhost:3200'`,
  so served on any other origin it posted cross-origin and scoped the cookie to the
  wrong host.
- No `trustedOrigins`, so Better Auth's CSRF check rejected any other origin with
  `403 Invalid origin` — correct behaviour, invisible cause.

### Decision

- `useSecureCookies` derives from `APP_URL.startsWith('https://')`. The rule stated
  honestly is _mark the cookie Secure exactly when it can be delivered_. Put TLS in
  front and set `APP_URL` to the https origin and it turns itself on.
- The browser client takes **no** `baseURL`. Omitted, it uses the origin it was
  served from; the browser knows where it is. Server code still resolves `APP_URL`,
  because a server has no current origin to infer — that asymmetry is the point.
- `TRUSTED_ORIGINS` is an explicit comma-separated allowlist, not a
  `http://localhost:*` wildcard. It is the CSRF boundary, and "it is only
  localhost" is a weak claim on a development machine running arbitrary project
  servers.

### Consequences

- `APP_URL` must name the origin the browser actually uses. It already had to, for
  redirects and callbacks; now the cookie name depends on it too, so a mismatch
  presents as "sign-in does nothing" — documented in the runbook with the exact
  `curl` that distinguishes it.
- Reaching the app on a second origin — a LAN address, a tunnel, the E2E server on
  its own port — requires adding it to `TRUSTED_ORIGINS`. That friction is
  intentional.
- The E2E suite is the reason all three were found. It runs against a production
  build on a different port, which is precisely the configuration that made every
  one of them visible.
