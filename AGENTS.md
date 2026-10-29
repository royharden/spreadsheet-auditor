# Spreadsheet Auditor agent instructions (v1)

This folder is the product Git repository. Keep product code and concise product documentation here; keep session transcripts, agent plans, reviews, backups and coordination records outside it.

- React, TypeScript, Vite, Supabase-compatible SQL and Deno. No Python or formula engine.
- Read README.md, docs/ARCHITECTURE.md and docs/DEFERRED-VALIDATION.md before edits. Honor the operator's current scope and mode. Initial source construction used Dirty Mode; no runtime checks are implied by commits or written tests.
- Formulas and workbook text are data. Never evaluate formulas, follow workbook links, upload workbook bytes, or write fixes back to the uploaded file.
- Keep rules/evidence/checker deterministic. Only bounded evidence goes to a model; model output cannot create detections, alter Confirmed findings or write formulas.
- Keep human events append-only, version linking explicit, note text device-local, and cloud access owner-scoped. Do not replace real integrations with fabricated success.
- Use synthetic or compatibly licensed fixtures. Do not commit client spreadsheets, personal data, credentials, raw session records or incompatible external corpora.
- Never put provider/server secrets in public environment variables. The only public placeholders are VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
- Canonical function-shared sources are listed in scripts/sync-function-shared.ts. Keep the five copies byte-equal and self-contained; validate Deno separately at activation.
- After activation, use the documented type/lint/test/build checks and preserve the one-time held-out pins. Until then, follow source-only constraints and record skipped validation honestly.

Changelog: v1 records the constructed product boundaries and deferred activation status. It installs or changes no skill.
