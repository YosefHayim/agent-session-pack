# ADR 0004: Lean CI Workflows

## Status

Accepted.

## Context

Agent Session Pack is a small TypeScript CLI. Multi-OS and multi-Node matrices
add CI cost and noise without proportional value: engines already allow
`node >= 20`, and the product surface is pure Node + system `zstd`/`sqlite3`
binaries rather than native OS-specific builds.

CI still needs to make push-to-main failures obvious and keep each gate easy
to reason about.

## Decision

Pin CI to a single platform and runtime:

- `runs-on: ubuntu-latest`
- `node-version: 22` (current LTS; engines allow `>=20`)

Use a lean workflow layout:

- `ci.yml` — single workflow with parallel jobs: `biome`, `typecheck`, `test`,
  `build`, plus a `ciGate` aggregator
- `reportFailure.yml` — reusable workflow called from `ci.yml` on main-branch
  gate failure (opens or updates a `ci-failure` issue)
- `publish.yml` — release / manual publish on `ubuntu-latest` + Node 22

Do not use OS or Node version matrices. Install system `zstd` and `sqlite3`
only on the test job (archive and Devin provider tests need them).

## Consequences

Fewer CI jobs, faster PR feedback, and one place to read the required gates.
Main-branch failures still surface through `reportFailure.yml`. Broader
compatibility is covered by `engines.node` rather than matrix CI.
