# orders-aggregator — Codex project instructions

Adapted selectively from Ivan's Claude Code kit for this hiring task. `TASK.md` and the repository `README.md` are the authoritative specification.

## Scope
- Existing Node.js 20+, TypeScript, Fastify 5, pg/PostgreSQL, Zod, Vitest project. Do NOT replace Fastify with NestJS or introduce a React frontend.
- Solve the exact requirements from TASK.md: discounts in daily-totals, investigate/fix c_7 anomalies for 2026-03-27 through 2026-03-31, create real result.json and SOLUTION.md.
- Preserve `createContainer(db, api)` signature and `OrdersApi` interface.
- Preserve `total = gross` as the original pre-discount paid-order total; add `gross`, `discount`, and `net`. Persist and aggregate monetary values in kopecks (integers) and convert to rubles only at API boundaries.
- Date grouping must respect each customer's IANA time zone and historical DST transition *for each order timestamp*, not today's offset. Verify Europe/Berlin March 29, 2026 boundaries with deterministic tests.
- Respect webhook duplicate/stale version handling and sync ordering. Avoid new races and lost updates.

## Workflow
1. Read TASK.md, README.md, package.json, schema, service/repository code and relevant tests. Run baseline tests if infrastructure is available.
2. Make a short plan: migration/storage -> ingestion/validation -> timezone/aggregation -> tests -> full integration run -> deliverables.
3. Implement the smallest correct changes, matching project conventions. No unrelated refactoring or dependencies unless strictly necessary.
4. Add tests for money (decimal rounding and discounts), DST/date boundaries, paid versus refunded orders, re-delivery/stale webhooks and real PostgreSQL behavior. Review corner cases rather than assert made-up expected values.
5. Run `npm run typecheck` and `npm test` against the required PostgreSQL; report commands/results. Do not silently skip integration tests.
6. For final `result.json`, use only actual response of `GET /customers/c_7/daily-totals?from=2026-03-27&to=2026-03-31` after clean compose DB, migration, completed POST /sync and completed mock webhook playback as documented. Do NOT fabricate the contents.
7. Write SOLUTION.md describing changes, exact root cause/evidence, checks performed, assumptions, other findings and future improvements.
8. Do not execute destructive commands (`docker compose down -v`, DB drops, git reset --hard). Do not edit .env or secrets. Local commits, merges into main, and deletion of successfully merged task branches are authorized by the Git workflow below. Do not push or submit externally without the user's explicit request.
9. Before handoff, review git diff and final file list. Ensure only source, needed tests/migrations, `result.json`, and `SOLUTION.md` are in the submission. Exclude images, `node_modules`, secrets and generated noise. The AGENTS.md/skills are developer tooling and may be excluded from the submission archive.

## Git workflow
- Use a separate branch from `main` for each feature, fix, or implementation stage. Do not implement task changes directly on `main`.
- Before starting, inspect the repository status and preserve existing user changes. If the project has no Git repository, initialize a local repository with `main` and commit the existing baseline before making task changes; exclude secrets, dependencies, and generated files.
- Implement the task on its branch, review the diff, run the required checks (including typecheck and real PostgreSQL tests), and fix any failures before merging.
- Commit the verified task changes, merge the task branch into `main`, then delete the successfully merged local branch with `git branch -d`. Do not force-delete unmerged branches.
- Complete this local branch -> checks/review -> commit -> merge -> branch deletion cycle without asking for confirmation each time. Report the outcome and commit hash at handoff. If checks or the merge are blocked, keep the branch and report the blocker.
- Push, remote branch deletion, PR publication, and external submission require a separate explicit user request.

## Relevant skills
- `$plan` for stepwise implementation.
- `$backend` and `$libs` for PostgreSQL, transactions, Fastify, Zod and Vitest.
- `$debug` for the reported March mismatch.
- `$tests` and `$review` for regression coverage and pre-submission audit.
- `$security` only if a security question or a secret-handling issue arises.

Do not present a hypothetical result.json as a real integration result.
