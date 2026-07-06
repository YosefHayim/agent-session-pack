# ADR 0004: Focused CI Workflows

## Status

Accepted.

## Context

CI should make push-to-main failures obvious and keep each job easy to reason about.

## Decision

Use focused workflow files:

- `ci.yml`
- `biome.yml`
- `typecheck.yml`
- `test.yml`
- `build.yml`
- `reportFailure.yml`
- `publish.yml`

`ci.yml` orchestrates the focused reusable workflows and exposes a single CI gate job.

## Consequences

Each check has one job. Main-branch failures can open or update a GitHub issue through `reportFailure.yml`.
