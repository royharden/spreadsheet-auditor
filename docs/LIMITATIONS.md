# Limitations

**Status: source constructed; runtime unverified; provisioning pending.** No install, test, build, corpus generation, evaluation, browser/auth flow, database migration or provider call has run. Written tests and static source checks do not establish detector accuracy, deployed security or interoperability. Activation work is in [DEFERRED-VALIDATION.md](DEFERRED-VALIDATION.md).

## Scope and synthetic circularity

The six rules are narrow heuristics, not a spreadsheet correctness proof, accounting review or financial model validation. The generator and detector share design assumptions. Even a future successful synthetic evaluation can miss defects common in real spreadsheets; independent real-file testing is still needed. Named by-design traps deliberately produce plausible false positives for review.

There are **no measured precision/recall, latency, cost or comparison results** yet. Planned allocation/count guards are not observed outcomes. `results/results.md`, `results/results.jsonl` and `results/failures.md` are generated only by a future evaluation. The named failure list is currently **pending**; after activation it must list every raw/surfaced FP and FN and every set-aside defect by workbook, sheet, cell and rule. No manual placeholder counts should substitute for it.

## File and formula coverage

- Input is macro-free `.xlsx` only. `.xls`, `.xlsm`, `.xlsb`, password-encrypted/OLE files and macro-bearing packages are outside scope. Google Sheets/Numbers/native formats are not supported.
- Limits are 5 MiB compressed, 50 MiB declared/actual inflation, 2,000 parts, 20 sheets and 50,000 formulas. A typed refusal is expected when a cap is exceeded; performance and memory near those caps are unmeasured. Strict ZIP assumptions may reject legitimate exports from other writers.
- Formula caches are read, not recalculated. A missing cache is unknown, not zero; stale caches can mislead both error detection and numeric heuristics. The cached-error rule reports its five configured error literals, not every possible Excel error family. Display grouping follows cheap direct error precedents, not a dependency graph.
- Structured references, 3-D and external references, whole-row/column expressions and unparsed syntax are opaque for affected structural checks. Data tables and unresolved shared formulas have explicit coverage categories. Array/spill members, non-anchor merged cells and date-formatted values have rule-specific abstentions. Defined names are retained without a full name/formula interpreter. Localized/future functions and uncommon number formats need real-file coverage.
- External links are listed and never followed. Pivots, charts, business semantics, workbook recalculation/editing, annotated workbook output and the four stretch rules (circularity, hardcoded formula constants, volatile functions, number-as-text) are not implemented. Stretch work is phase 2 after real validation.
- DOCTYPE/entity refusal applies to XML parts the reader parses. Unused package parts, including comments used by synthetic injection cases, are not comprehensively interpreted. The app is not a malware scanner.

## Explanations and models

Evidence is local and bounded to 2 KiB/four neighbours per side. This can omit context necessary to recognize an intentional formula, tax rate or unit convention. Oversize required evidence becomes template-only; it is not silently truncated. Numeric agreement and citation membership do not prove that explanation prose is semantically true.

Template mode is the default. Synthetic sample Mock responses are demonstrations, explicitly labelled, and cannot support model evaluation claims; non-sample cache misses fail visibly. A recorded replay is not a fresh live measurement. Only bounded bundles leave the browser in explicit Live mode, but those bundles can contain formulas, values, labels and sheet names. Local JSON/Markdown exports can contain those fields and device notes too.

Generative Live needs user auth, actual function configuration and verified dated pricing for its selected model; prices are currently absent. Model ids, provider accounts, token limits, API availability and deployed timeout behavior remain unverified. The quota limits attempts rather than dollars; the Node evaluator separately requires a finite budget and verified prices before reserving worst-case spend. Unknown cost stays `unknown`, and replay is labelled `replay`.

Jev applies to **Review findings only**, currently the mixed-units rule. It does not triage Likely tax-rate plugs. Its default confidence threshold is conservative and uncalibrated; the comparison threshold `N` is **0** in configuration. The published win condition additionally requires fewer surfaced false positives and no greater common-Review set-aside defect count than the generative arm; missing inputs mean `not-evaluated`.

Paid Jev is deliberately disabled in browser-facing readiness/POST before quota or provider access. A documented service-enforced worst-case output/spend bound has not been verified; setting keys/model ids or a Boolean flag does not resolve that gap. The Choice request/parser and recorded-live replay source remain, with no undocumented `max_tokens` parameter. There is no claimed Jev advantage.

## Identity, storage and authorization

File identity is exact SHA-256 of bytes. Re-saving, changing formatting or inserting rows can create a new version and shift cell-based finding identities. There is no row-insertion-stable identity or semantic version diff. Carried rulings compare textual/typed formula hashes; equivalent rewrites may still become stale. Links are explicit and immutable to clients; stale history is retained without applying its decision.

Local rulings use IndexedDB/localStorage or a labelled memory fallback. A local adapter serializes one instance; multiple tabs can still race on its shared JSON document. Browser storage is not promised encrypted or shared across devices. Cloud metadata is user-scoped by source queries and RLS policies, but SDK behavior, real two-user isolation, session transitions, quota concurrency and migration execution are unverified.

Note text stays in device KV keyed by user/event and may appear in a local export; only `has_note` goes to the database. A different device cannot recover that text. Cloud metadata and the device note write are not atomic: metadata can commit while a note write fails, producing an explicit partial-save error and a marker without durable note text. Duplicate event ids preserve the first write and are not a note-repair mechanism. Display names and hashes are still metadata and may be sensitive; display names can be blanked.

Owner/workbook/request generation guards are present to reject late asynchronous UI results, and human decisions remain authoritative, but browser tests have not run. CORS is not authentication. An anon project key does not replace a user JWT. Source policies and static SQL tests do not establish deployed isolation.

## Evaluation and external material

The final-split experiment is intended to run once after settings are fixed on dev. Hash pins and durable receipts permit missing-work resume only under identical context. Completed runs cannot be repeated, and an abandoned lease requires manual, evidence-preserving recovery. These controls cannot stop an operator from editing files or copying the experiment elsewhere; they are not a tamper-proof service. Filesystem/Windows recovery behavior is still pending validation.

Any optional external/mutated EUSES-style corpus work is **local only**, subject to its own licensing and input-format feasibility; many older files may be unsupported `.xls`. No external corpus or copyleft implementation was vendored as part of this construction. Dependency licenses and security advisories still require review at installation. Do not commit or redistribute third-party data/code without checking the applicable rights.
