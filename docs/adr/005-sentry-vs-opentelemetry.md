# ADR 005: Sentry for Application Errors, OpenTelemetry for Traces / Metrics (#115)

## Status

Accepted

## Context

BrandBlitz needs production observability across three distinct
lenses:

1. **Application errors** — uncaught exceptions, request-level
   failures, with source-mapped stack traces and a UI good enough
   for non-SRE engineers to debug a 3am page.
2. **Distributed traces** — per-request causality across the API,
   the deposit-monitor, the BullMQ queues, and Soroban RPC calls.
3. **Metrics** — request rates, queue depths, p95 latencies.

Picking one vendor for all three was tempting (Datadog, New Relic,
Sentry's "everything" tier). Each comes with a cost-and-flexibility
trade-off that we explicitly evaluated.

## Decision

We split the stack along the lens boundary:

- **Errors → Sentry**. The frontend and backend both report
  unhandled exceptions and explicitly-captured errors to Sentry.
  Source maps are uploaded on every CI build (see `ci.yml`).
- **Traces + metrics → OpenTelemetry**. The API initialises the
  OpenTelemetry SDK with the OTLP/HTTP exporter; the destination is
  configurable via `OTEL_EXPORTER_OTLP_ENDPOINT` so the same code
  ships to Jaeger (local dev), Tempo (staging), or Grafana Cloud
  (prod) without recompilation.

No vendor SDK calls in application code outside the two thin
adapters in `apps/api/src/lib/sentry.ts` and the future tracing
bootstrap.

## Rationale

- **Right tool for the lens**: Sentry's UI is the best-in-class
  error-investigation surface; nothing OTel-native matches it for
  triage. Conversely, OpenTelemetry's trace API is the de facto
  industry standard and lets us swap backends without rewriting
  instrumentation.
- **Vendor-lock asymmetry**: Sentry's data shape is proprietary, but
  errors are intrinsically vendor-specific (source maps, fingerprints).
  Traces and metrics are commodity data; switching trace vendors
  shouldn't force a code rewrite.
- **Cost shape**: error volume is bounded by code quality; trace
  volume is bounded by request volume. Splitting the lenses gives us
  separate cost controls instead of bundling them.
- **Operational simplicity in dev**: OTel-with-Jaeger is a single
  `docker compose up` away. Sentry has a free dev tier. No vendor
  asks for an SDK in our hot path.

Considered alternatives:

- **All-in-Sentry** (errors + tracing + performance): viable, but
  ties tracing to a vendor and pays the proprietary-shape cost on
  both lenses.
- **All-in-Datadog / New Relic**: powerful, but the cost curve
  bites harder than the split. Also pulls a vendor SDK into the hot
  path.
- **All-in-OpenTelemetry** (errors as span events): possible, but
  error triage UX is materially worse than Sentry, and the
  source-map upload story doesn't exist in the OTel ecosystem yet.

## Consequences

- Two observability vendors to manage — secrets, dashboards, and
  alert routes need to live in both places.
- Source maps must continue to upload to Sentry on every build
  (already wired in `ci.yml`).
- A future OpenTelemetry bootstrap (`apps/api/src/lib/tracing.ts`)
  will follow this ADR's contract: OTLP exporter only, no vendor
  SDKs.
- Cross-lens debugging requires correlating a Sentry event with a
  trace ID. We propagate `traceparent` on every response so a
  Sentry event in the frontend can link back to its server-side
  trace.

## References

- `apps/api/src/lib/sentry.ts`
- `ci.yml` source-map upload steps
- Closes #115.
