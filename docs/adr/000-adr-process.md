# ADR 000: Architecture Decision Record Process

## Status

Accepted

## Context

The codebase carries decisions that aren't documented anywhere a new
contributor would find them — why we chose Postgres over SQLite, why
escrow logic lives where it does, why migrations are home-grown rather
than Prisma/Knex. Tribal knowledge slows reviews, encourages rework,
and makes onboarding take longer than it should.

The existing `docs/` tree explains *what* BrandBlitz does, not *why*
the engineering choices are what they are. ADR 001 (phone storage) is
the only counter-example today.

## Decision

BrandBlitz captures load-bearing engineering decisions as
**Architecture Decision Records** (ADRs) under `docs/adr/`, following
the Michael Nygard format.

### Filename convention

`docs/adr/NNN-short-slug.md`, where `NNN` is a zero-padded sequence
number starting from `000`. Numbers are never re-used; superseded
ADRs stay in the tree with `Status: Superseded by ADR NNN`.

### Sections (in order)

1. `# ADR NNN: One-Line Title`
2. `## Status` — `Proposed | Accepted | Superseded by ADR NNN | Deprecated`.
3. `## Context` — what's driving the decision. Often the simplest place to capture trade-offs.
4. `## Decision` — what we're doing. Concrete enough that someone reading it can verify the codebase matches.
5. `## Rationale` — why this choice over the alternatives.
6. `## Consequences` — what this commits us to, including operational / migration / support burden.

Short ADRs are encouraged. Decisions that won't fit one A4 page may
need to be split.

### When to write an ADR

- The decision affects more than one module / team.
- The decision is hard to reverse (migrations, public API, on-chain shape).
- A reasonable reviewer would ask "why didn't we do X instead?".
- The decision is being made for a reason that isn't obvious from the
  code (compliance, third-party constraint, prior incident).

Routine choices (naming a function, picking a library version) do
not need an ADR.

### Lifecycle

- Proposed → opened as a PR for review.
- Accepted → merged. Status updates do NOT require a new PR by
  themselves; bundle them with the implementation PR that lands the
  decision.
- Superseded → never edit the old ADR's body. Open a new ADR that
  references the old one (`Superseded by ADR NNN`) and update the
  old one's `Status` line.

## Consequences

- Onboarding shortens: a new contributor can read the ADR index and
  understand the why behind the architecture without spelunking the
  git log.
- PR review picks up a new artifact for non-trivial decisions; this
  is an explicit cost worth paying.
- The README links to `docs/adr/` so the index is discoverable.

## Template

Copy the block below for new ADRs and replace bracketed placeholders.

```markdown
# ADR NNN: [Title — single short line, capitalised like a sentence]

## Status

[Proposed | Accepted | Superseded by ADR NNN | Deprecated]

## Context

[What's the issue, constraint, or trigger? Where in the system does
the decision live? What forces are at play?]

## Decision

[The choice we made. Verifiable against the code.]

## Rationale

[Why this option won. What did we consider and reject?]

## Consequences

[What we're now committed to. Maintenance burden. Migration steps.]
```
