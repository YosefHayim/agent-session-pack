# Kiro Session Round-Trip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove a latest Kiro CLI session can be copied, compressed, restored, and verified without touching the original session file.

**Architecture:** Build a minimal TypeScript CLI/library that discovers the latest Kiro JSONL session, copies it into a repo-local fixture directory, compresses that copy with `zstd`, restores it to a separate directory, and compares SHA256 hashes. JSONL parsing is used only as validation; exact bytes are the source of truth.

**Tech Stack:** Node.js 24, TypeScript, Vitest, native `zstd` CLI, Node `crypto`, Node `fs/promises`.

## Global Constraints

- No daemon or watcher.
- Never delete, rewrite, or compress the real `~/.kiro/sessions` source file.
- Use exact-byte round-trip verification with SHA256.
- Test first: Vitest must fail before production implementation exists.

---

### Task 1: Kiro Exact-Byte Round Trip

**Files:**
- Create: `tests/kiroRoundTrip.test.ts`
- Create: `src/kiroRoundTrip.ts`
- Create: `src/cli.ts`

**Interfaces:**
- Produces: `runKiroRoundTrip(options?: RoundTripOptions): Promise<RoundTripResult>`
- Produces: `formatEvidence(result: RoundTripResult): string`

- [x] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Write minimal implementation**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Run CLI evidence command**
