# Service Sizing

These limits are conservative defaults for the Compose stack. They are intended
to prevent one runaway service from starving the host while we are still
learning the real workload shape.

| Service | CPU | Memory | Rationale |
|---|---:|---:|---|
| `api` | `1.0` | `1G` | Express, PostgreSQL client pooling, and response serialization stay responsive under normal request bursts. |
| `worker` | `0.5` | `512M` | The payout worker is mostly I/O bound and should not compete with the API for host CPU. |
| `web` | `1.0` | `1G` | Next.js SSR and image optimization can spike memory, so the cap keeps those spikes bounded. |

Notes:

- These are `deploy.resources.limits` entries in `docker-compose.yml`.
- They are a starting point, not a final capacity plan.
- Revisit after a load test and adjust if the worker or web app shows sustained throttling.

