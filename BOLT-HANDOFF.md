# Bolt infrastructure handoff: Spreadsheet Auditor

## Target and readiness

**Status: source constructed; runtime unverified; provisioning pending.**

- App root: this product repository, with `package.json` at its root. Source is local; no push, import, cloud connection or publication has occurred.
- Database choice: **Bolt Database**, using the supplied Supabase-compatible client, migrations and Deno function.
- Intended target: a fresh database. Existing target baseline/applied migration history: **UNKNOWN; unprovisioned**. Inspect any connection encountered later before changing it; preserve populated resources.
- Hosting and final domain: pending selection. Current action: **inspect and prepare only**. Provisioning, deployment and publication require separate authorization.
- No dependency installation, lockfile, build, test, generator/evaluator run, auth round trip, database operation or provider call establishes readiness yet. See [deferred validation](docs/DEFERRED-VALIDATION.md).

## Build and connection

These are future activation commands, not recorded successes.

| Item | Source / command |
|---|---|
| Runtime | `package.json` declares Node `>=20`; exact compatibility with the selected Vite/toolchain versions is unverified. |
| Initial dependencies | `npm install`, review advisories and resolved licenses, pin exact versions and commit a reviewed lockfile; only then use `npm ci`. |
| Checks | `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`; Vite output is `dist/`. |
| Local development | `npm run dev`; use the project's allocated port when starting it. No server was started during construction. |
| Public connection | `src/lib/supabase.ts`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Missing either keeps the client and function URL null. |
| Function URL | Derived as `<public project URL>/functions/v1/explain-findings`; no project URL is hard-coded. |
| Shared edge modules | `npm run sync:function` copies five canonical modules; run the byte-equality test and Deno checks after any authorized change. It was not run during construction; actual copies already exist. |
| Edge check | `deno check --config supabase/functions/explain-findings/deno.json supabase/functions/explain-findings/index.ts` is pending. |

Frontend dependencies are unverified caret ranges: React/React DOM `^19.1.0`, Vite `^7.1.0`, TypeScript `^5.9.0`, Supabase JS `^2.50.0`, fflate `^0.8.2`, zod `^4.0.0`, and fast-xml-parser `^5.2.0`. **fast-xml-parser: pending pin exact after advisory check at activation.** Test/lint dependencies are likewise unresolved. The Deno import map selects candidate `npm:zod@4.0.0` and `npm:@supabase/supabase-js@2.50.0`; their resolution and deployment compatibility are unverified.

## Database inventory

| Order | Exact migration | Resources | Applied |
|---|---|---|---|
| 1 | `supabase/migrations/20261024000100_rulings.sql` | `workbook_versions`, `rulings`, insertion-order identities, owner SELECT/INSERT policies and indexes | Pending |
| 2 | `supabase/migrations/20261024000200_explain_quota.sql` | `explain_quota_config`, `explain_quota_user`, `explain_quota_global`, `explain_reservations`, `reserve_explain_quota(uuid, integer)` | Pending |

Rulings/version rows are private per signed-in user. A linked version must reference an existing version owned by that user in the same lineage; a ruling must reference its registered version and lineage. Clients receive no UPDATE/DELETE rights. `has_note` records note presence; note text, formulas, values and bundles are not database fields. File display names are metadata and can be blanked.

All four quota tables have RLS and no client policies/direct access. The security-definer RPC fixes `search_path = public, pg_temp`, derives identity from `auth.uid()`, rejects duplicate request UUIDs, and atomically reserves **`2 * n` attempts** against user/global UTC-day counters. Seeded caps are **1,000 user / 10,000 global attempts per day**. First inserts and conflict updates both obey caps; any failure rolls back the transaction. PUBLIC execute is revoked; authenticated execute is granted. No Realtime, storage buckets, schedules or background workers are required.

Inspect migration tracking first; apply only pending migrations in order. A file or table's existence does not prove migration completion. Investigate a timed-out operation before retrying; do not drop/recreate resources to hide drift.

## Function and secrets

`supabase/functions/explain-findings/index.ts` is configured in `supabase/config.toml` with `verify_jwt = true`, the local import map and the explicit entrypoint. It calls `supabase.auth.getUser(callerJwt)` and uses that caller JWT for the quota RPC; an anon project key is not user authentication.

- `POST`: `{requestId, arm: 'generative' | 'jev', bundles}` → `{results}`. Order: authenticate → stream/read/validate → configuration → one reservation → provider attempts → strict schema/id/hash binding.
- Bounds: **512 KiB** actual request body; **1–200 bundles**, each **2,048 canonical UTF-8 bytes** including its hash; unique finding ids and recomputed hashes; unknown fields rejected. Generative output is capped at **4,096 tokens**, with **30 seconds per attempt** and **at most one retry** inside the same reservation. The browser edge client adds no retry.
- `GET`: authenticated readiness plus the selected public model id; no body validation, quota or provider call. Default readiness is generative. `?arm=jev` reports Jev's disabled state.
- Errors: authentication 401; validation 400/413; missing model/secret/quota configuration or RPC infrastructure 503; known cap/replay refusal 429; provider/response failure 502. No bundle text or provider bodies are logged by function source.
- CORS: OPTIONS preflight, GET/POST, wildcard origin with bearer authorization and the declared request headers. CORS is not an authorization check.

| Variable | Consumer / requirement |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Platform-provided function connection values; verify their availability on the actual target. |
| `ANTHROPIC_API_KEY`, `EXPLAIN_MODEL` | Server-only generative provider key and sole allowed model selection; required for that live path. Model/account availability is unverified. |
| `EXPLAIN_MAX_TOKENS` | Optional server output cap, integer 1–4,096; default 4,096. |
| `TYPESAFE_API_KEY`, `JEV_MODEL` | Optional future Jev configuration. Setting them does **not** enable paid Jev. |
| `EVAL_BUDGET_USD` | Node evaluator budget, not a browser secret or an edge-quota replacement; live evaluation also needs verified dated prices. |

Provider secrets belong in server settings, never `VITE_` variables, source or chat. Paid Jev is deliberately refused with 503 before quota/provider access because its documented service-enforced worst-case output/spend bound is unverified. Choice request/parsing and recorded replay source remain. No undocumented `max_tokens` field or verification toggle enables it. The browser also keeps Live disabled until the configured model has an entry in the currently empty dated price table.

## Auth and owner prerequisites

Source implements email/password sign-up, sign-in, sign-out, session restoration, recovery email and password update. `AuthPanel.tsx` requests recovery to **`location.origin + location.pathname + '?recovery=1'`**; `useAuth` responds to `PASSWORD_RECOVERY`, and the recovery view calls `updateUser({password})`. The query string alone does not establish a recovery session.

At future setup, choose email confirmation settings, set Auth **Site URL** to the final app URL, and allowlist the exact deployed recovery redirect plus any authorized development redirect. The final domain/path and email/redirect/token behavior are unknown. Use authorized accounts and synthetic workbooks for checks. Provider accounts, keys, exact model ids, pricing and any future GitHub/Bolt access remain owner prerequisites.

## Activation checks

Every item is pending: install/pin/advisory review; type/lint/tests/build; Deno dependency check; migration application; real two-user RLS and immutable-link checks; concurrent quota caps/replay/rollback; JWT/CORS/readiness/missing-config 503; configured provider response/timeout behavior; browser auth/recovery and sample v1/v2 journey. Record actual receipts rather than inferring cloud success from source or mocks.

For corpus inspection, use a new scratch output, for example `npm run generate -- --output ../auditor-corpus-preview`. Then generate the **fresh, previously unused canonical output once** with `npm run generate -- --freeze`. Exclusive writes refuse overwrites: do not run ordinary generation and then `--freeze` into the same output. No corpus, freeze or evaluation results have been generated. Final evaluation is separately gated by the frozen artifacts, clean committed source and the one-time experiment guard.

## Inspection prompt

> Read BOLT-HANDOFF.md and inspect the supplied repository at its intended reviewed revision. The target is Bolt Database, but infrastructure baseline and runtime readiness are unknown. Compare the two ordered migrations, function, auth flow, public configuration and server-secret names with the actual source. If authorized read-only access is available, inspect migration history and existing schema without changing it. Return a concise setup plan, deployment gaps, owner prerequisites and pending checks. Preserve the app design and any existing data. Do not push or import source, create/change cloud resources, apply migrations, deploy functions, enter secrets, enable schedules or publish. Do not describe source, mocks or unexecuted checks as completed infrastructure.
