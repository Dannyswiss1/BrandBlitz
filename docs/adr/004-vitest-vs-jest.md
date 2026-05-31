# ADR 004: Vitest over Jest for Unit Tests (#16)

## Status

Accepted

## Context

BrandBlitz's TypeScript surfaces (API, web, internal packages) need
a unit-test framework. Jest is the legacy default in the broader
ecosystem, but it's increasingly painful in repos with:

- ESM-first source code.
- Native-ESM third-party deps (e.g. `node-fetch@3`, `nanoid`,
  `chalk@5`).
- A TS pipeline that doesn't pre-compile (we use `tsx` for dev).

Vitest matches Vite's loader and runs ESM + TypeScript natively, with
a Jest-compatible API surface.

## Decision

All TypeScript unit tests in this repo run under **Vitest**.

- API: `apps/api/vitest.config.ts`.
- Web: `apps/web/vitest.config.ts` + `apps/web/vitest.setup.ts`.
- Packages: `packages/*/vitest.config.ts` (where applicable).
- Test command at every workspace level: `pnpm test`.

End-to-end tests (Playwright) and load tests (k6) stay in their own
tools — this ADR is scoped to unit tests.

## Rationale

- **ESM-native**: no `--experimental-vm-modules` flag and no
  `transformIgnorePatterns` gymnastics for ESM deps.
- **Speed**: Vitest's worker pool + Vite's incremental graph give
  noticeably faster cold + watch runs on this codebase.
- **Jest-compatible API**: `describe / it / expect / vi.fn() /
  vi.mock()` line up with Jest's `jest.fn()` / `jest.mock()` so
  contributors don't need to relearn matchers or mocking semantics.
- **Built-in coverage**: V8 coverage out of the box. No `babel-istanbul`
  config to maintain.
- **First-class TS**: type-checking happens at the project level
  (`tsc --noEmit`) rather than via a babel-typescript plugin chain.

Considered alternatives:

- **Jest**: maintains the bigger ecosystem but the ESM story is still
  rough. `ts-jest` + `babel-jest` toggling is a recurring source of
  config bugs.
- **node:test + ts-node**: minimal, but the assertion library is
  more bare than `expect` and the mocking story is weak.
- **Mocha + Chai + Sinon**: fine, but three separate libraries to
  align versions for. Not worth it when one tool covers all three.

## Consequences

- Snapshot files use Vitest's format. PR reviewers learn the
  `__snapshots__` shape.
- `vi.mock(...)` is hoisted like Jest's `jest.mock(...)`; tests can
  call `vi.importActual<T>(...)` for partial mocks. Existing tests
  use this pattern (see `apps/web/src/lib/api.test.ts`).
- Coverage reports use the V8 backend; thresholds in
  `vitest.config.ts` enforce the floors per-workspace.
- No production migration cost — this codebase started with Vitest.
  The ADR captures the choice so a future "should we switch to
  Jest for ecosystem familiarity?" PR has a documented prior
  decision to argue against.

## References

- `apps/{api,web}/vitest.config.ts`
- Closes #16.
