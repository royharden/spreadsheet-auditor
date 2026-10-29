# Spreadsheet Auditor

Audit one macro-free `.xlsx` locally, review cell-level evidence, record human rulings, and export Markdown or versioned JSON. React, TypeScript and Vite; optional Bolt Database and an authenticated Deno edge function.

**Source constructed; runtime unverified; provisioning pending.** This construction run performed no dependency installs, tests, builds, application launches, workbook generation, evaluation, migrations, provider calls or deployment. Static inspection and syntax parsing are not runtime validation. There is no lockfile yet. Dependency ranges and Deno pins remain unverified.

## What is in the source

- Browser worker and OOXML reader with macro/ZIP/XML refusals; 5 MB compressed, 50 MB declared/actual inflated, 20 sheets and 50,000 formula-cell limits. Unsupported formulas are reported, not evaluated.
- Six deterministic rules: `ERROR_VALUE`, `BROKEN_REF`, `FORMULA_DRIFT`, `CONSTANT_PLUG`, `SUM_RANGE_SHORT`, `MIXED_UNITS`. Suggested fixes come from code; the app never modifies an uploaded workbook.
- Bounded evidence (2,048 UTF-8 bytes, up to four neighbours per side), address/number checking, and checked template fallback. An explanation that still fails is unavailable.
- Review controls, local-only notes, exact-file ruling replay, explicit version carry-over with stale-formula markers, and complete MD/JSON exports including dismissed and set-aside findings.
- Seeded five-template corpus/sample generator, evaluation matcher, Wilson intervals, named failures, injection-pair comparisons and pinned missing-only experiment resumption. All generators and tests are source only.
- Optional email/password auth, metadata-only cloud ruling storage, quota SQL and `explain-findings` function source. No cloud resources have been provisioned.

## Modes and privacy

Template is the offline default. Without public connection configuration, rulings use browser storage (with the stated fallback); nothing is uploaded. Storage can fail or become temporary. Back up important decisions with an export.

Mock uses a hash-keyed cache and fails visibly on a miss. The committed cache is empty. The two generated sample hashes receive in-memory synthetic responses labeled as demo replay, including a deliberately invalid citation. Other files cannot receive invented mock responses. Synthetic cache responses never qualify as model evaluation evidence.

Live requires sign-in, configured function readiness, and verified dated prices for the actual server model. Only selected bundles leave the browser: they can contain business data. Preview them before sending. Full workbook bytes are never uploaded. Provider secrets stay server-side. The empty price table currently disables Live in the UI and paid evaluation.

Cloud tables store identities, cell addresses, hashes, rulings, version links and a note-intent marker, not formulas, values, evidence or note text. Notes stay on their originating device and are included in that device's export when available. A partial note-save failure can leave cloud metadata without retrievable note text.

Jev is an optional Review-only judgment arm, paired with code templates. With the chosen tiers it triages only `MIXED_UNITS`; the generative arm also covers Likely findings. Jev is **not run** and excluded from the default. Paid Jev calls are disabled pending a documented, verified output/spend bound; entering a key does not enable the server path. Recorded-live replay source exists. The proposed defect-loss bound is `N = 0`, fixed on dev before the held-out experiment.

## Activation, after Dirty Mode is explicitly closed

Run from this repository root. These are future steps, not completed checks:

1. Verify dependency versions/advisories and runtime compatibility (package minimum is Node 20; actual Vite/Node compatibility is unverified). Run `npm install`, review/pin exact versions and commit the resulting lockfile. Thereafter use `npm ci`.
2. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. Check the function separately with `deno check --config supabase/functions/explain-findings/deno.json supabase/functions/explain-findings/index.ts`.
3. Generate inspection data into a separate directory: `npm run generate -- --output fixtures/inspection`. Inspect written tests and spreadsheet interoperability before freezing the final corpus.
4. On a fresh canonical output directory, run `npm run generate -- --freeze`. The writer refuses existing files; running plain generation and then freezing the same output is not supported. Inspect actual counts and measured digests.
5. Evaluate dev first: `npm run eval -- --split dev --systems 1`. Model runs require verified configuration/prices, a deliberate budget, and recorded-live provenance. `--mode live --record` can spend money; it is not authorized by this README.
6. Freeze code, prompts, thresholds and model choices, then perform the one held-out experiment, for example `npm run eval -- --split heldout --systems 1,2,3`. Unavailable systems report not run. Only missing work may resume under identical pins. Existing leases fail closed; preserve an abandoned lease by manual rename only after confirming all workers are stopped.
7. Inspect [BOLT-HANDOFF.md](BOLT-HANDOFF.md) before any future infrastructure work. Verify auth, two-user RLS, quota races, browser workers, sample v1/v2 and exports with synthetic data.

`npm run dev` is the application entrypoint after activation; no server was started here. `npm run sync:function` updates the five function source copies; its equality test and Deno check must follow. `npx tsx scripts/build-synthetic-cache.ts` can materialize the sample cache after setup; preserve existing cache contents before replacing it. Neither script has run.

## Results

**Circularity:** the same author defines the generator, planted defects and rules. Author-generated scores measure consistency with planted definitions, not discovery on real spreadsheets. Shape-separated templates do not remove that limitation.

<!-- EVAL-RESULTS:BEGIN -->
Results not yet generated. No corpus has been empirically frozen and no evaluation has run. Jev: not evaluated; default remains templates. No accuracy, latency or cost measurements are claimed.
<!-- EVAL-RESULTS:END -->

The evaluator writes `results/results.md`, `results/results.jsonl`, `results/failures.md`, recording/ledger artifacts and this generated block. Missing measurements remain N/A/unknown; replay is labeled separately. Do not hand-enter benchmark numbers. See [LIMITATIONS](docs/LIMITATIONS.md) and [DEFERRED-VALIDATION](docs/DEFERRED-VALIDATION.md).

## Deliberate cuts

`call_ledger` and `eval_runs` business tables are replaced by local JSONL. `CIRCULAR`, `HARDCODE_IN_FORMULA`, `VOLATILE` and `NUMBER_AS_TEXT` remain phase 2 until real validation. The six core rules, checker, template mode, evaluation source and one-time held-out experiment are retained; execution is deferred. Source allocation is 40 dev plus 40 held-out workbooks, not a generated-count claim.

Original implementation under MIT; idea references and dataset restrictions are in [NOTICE](NOTICE). Architecture and activation inventories are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [BOLT-HANDOFF.md](BOLT-HANDOFF.md).
