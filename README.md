# tinyclaw-infra

Infrastructure layer for [TinyClaw](https://github.com/TinyAGI/tinyclaw).
Wraps the core with deployment, isolation, dispatch, and observability
without modifying TinyClaw source code.

## Architecture

```
          ┌──────────────────────────────────────┐
          │          gateway (:8080)              │
  ───────►│  auth · proxy · task dispatch        │
          │  /metrics (prometheus)               │
          └──────────┬───────────────┬───────────┘
                     │               │
        core network │               │ worker network
                     │               │
          ┌──────────▼─────┐  ┌──────▼───────────┐
          │ tinyclaw-core  │  │ worker-coder      │
          │ :3777          │  │ worker-reviewer   │
          │                │  │ external workers  │
          │ discord  ──┐   │  │ (Railway, etc.)   │
          │ telegram ──┤   │  └──────────────────┘
          │ whatsapp ──┘   │
          └────────────────┘
```

Each layer is optional beyond the core:

| Layer | Components |
|-------|------------|
| Core deployment | Docker orchestration, gateway auth, channel containers |
| Agent isolation | Worker containers with per-agent permissions |
| Worker protocol | Task dispatch API for local and remote workers |
| Observability | Prometheus metrics from gateway and workers |

## Quick start

Requires Docker with Compose v2.17+ (`additional_contexts` support).

```bash
git clone https://github.com/TinyAGI/tinyclaw.git
git clone https://github.com/shwdsun/tinyclaw-infra.git

cd tinyclaw-infra
cp .env.example .env
# edit .env — set API_KEY, provider keys, bot tokens
```

Start core + gateway:

```bash
docker compose up -d
```

Enable a channel:

```bash
docker compose --profile telegram up -d
```

Enable monitoring:

```bash
docker compose --profile monitoring up -d
# Prometheus at http://localhost:9090
```

Verify:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:8080/api/queue/status
```

## Workers

Workers run agent invocations in isolated containers. Each worker
has its own filesystem, network scope, and provider credentials.

Define workers in `docker-compose.override.yml` or uncomment the
examples in `docker-compose.yml`. A worker needs:

```yaml
worker-coder:
  build:
    context: .
    dockerfile: docker/Dockerfile.worker
  environment:
    - GATEWAY_URL=http://gateway:8080
    - API_KEY=${API_KEY}
    - AGENT_ID=coder
    - PROVIDER=anthropic
    - MODEL=sonnet
    - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
  volumes:
    - code-workspace:/workspace         # read-write
  networks:
    - workers

worker-reviewer:
  build:
    context: .
    dockerfile: docker/Dockerfile.worker
  environment:
    - GATEWAY_URL=http://gateway:8080
    - API_KEY=${API_KEY}
    - AGENT_ID=reviewer
    - PROVIDER=anthropic
    - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
  volumes:
    - code-workspace:/workspace:ro      # read-only
  networks:
    - workers
```

Workers are on the `workers` network and can only reach the gateway.
They cannot access the core or other containers directly.

### External workers

Any process that speaks HTTP can be a worker. Run it anywhere
(Railway, a VM, your laptop) and point it at the gateway:

```bash
GATEWAY_URL=https://your-gateway.example.com \
API_KEY=your-key \
AGENT_ID=coder \
PROVIDER=anthropic \
MODEL=sonnet \
node worker/index.js
```

## Worker protocol

The gateway exposes a task dispatch API. Workers poll for tasks,
execute them, and submit results.

### Submit a task

```
POST /api/tasks
Authorization: Bearer <API_KEY>

{ "agent": "coder", "message": "Refactor auth module", "metadata": {} }

→ 201 { "id": "1", "agent": "coder", "status": "pending", ... }
```

### Claim a task (worker)

```
POST /api/tasks/claim
Authorization: Bearer <API_KEY>

{ "agent": "coder" }

→ 200 { "id": "1", "agent": "coder", "status": "claimed", "message": "...", ... }
→ 204  (no pending tasks)
```

### Submit result (worker)

```
POST /api/tasks/<id>/result
Authorization: Bearer <API_KEY>

{ "result": "Done. Refactored auth into three modules." }
  or
{ "error": "CLI process exited with code 1" }

→ 200 { "id": "1", "status": "completed", "result": "...", ... }
```

### Check task status

```
GET /api/tasks/<id>       → 200 task object
GET /api/tasks            → 200 all tasks
GET /api/tasks?status=pending → 200 filtered
```

### Task lifecycle

```
pending ──► claimed ──► completed
                   └──► failed
                          │
           (stale claims reset after 10 min)
           claimed ──► pending
```

Completed and failed tasks are pruned after 1 hour.

## Observability

The gateway exposes Prometheus metrics at `GET /metrics` (no auth).

**Gateway metrics:**

| Metric | Type | Description |
|--------|------|-------------|
| `gateway_requests_total` | counter | HTTP requests by path and status |
| `gateway_tasks_created_total` | counter | Tasks submitted by agent |
| `gateway_tasks_claimed_total` | counter | Tasks claimed by agent |
| `gateway_tasks_resolved_total` | counter | Tasks completed/failed by agent |
| `gateway_tasks_pending` | gauge | Current pending tasks |
| `gateway_tasks_claimed` | gauge | Current claimed tasks |

**Worker metrics** (each worker at `:9100/metrics`):

| Metric | Type | Description |
|--------|------|-------------|
| `worker_tasks_total` | counter | Tasks processed by status |
| `worker_busy` | gauge | 1 if processing, 0 if idle |

Enable the monitoring profile to run Prometheus:

```bash
docker compose --profile monitoring up -d
```

## Design decisions

**`network_mode: "service:core"`** — TinyClaw channel clients hardcode
`localhost:${API_PORT}`. Sharing the core's network namespace avoids
forking TinyClaw to make this configurable.

**No Redis** — TinyClaw uses SQLite (WAL mode, retry, dead letter queue).
Single-node, SQLite is sufficient. The gateway's task queue is in-memory
because tasks are transient dispatch units, not durable records.

**Two networks** — `core` for TinyClaw internals, `workers` for isolated
agent execution. Workers can only reach the gateway. This is the
container-level enforcement of permission boundaries.

**Zero-dependency gateway** — The gateway uses only Node.js built-ins.
No npm packages, no build step, no supply chain to audit.

## Repo structure

```
tinyclaw-infra/
├── gateway/
│   ├── index.js            # HTTP server, auth, routing
│   ├── proxy.js            # reverse proxy to core
│   ├── tasks.js            # in-memory task queue
│   └── metrics.js          # prometheus metrics
├── worker/
│   └── index.js            # poll-execute-submit loop
├── monitoring/
│   └── prometheus.yml      # scrape configuration
├── docker/
│   ├── Dockerfile.core     # TinyClaw queue processor + API
│   ├── Dockerfile.gateway  # gateway (alpine, ~15MB)
│   ├── Dockerfile.worker   # isolated agent runtime
│   ├── Dockerfile.channel  # Discord / Telegram client
│   └── Dockerfile.whatsapp # WhatsApp client (chromium)
├── docker-compose.yml
├── .env.example
└── README.md
```

## Upstream improvements

Not blockers, but would be cleaner if contributed to TinyClaw:

- **Pairing API** — channel clients import `pairing.ts` directly.
  API endpoints would remove the shared volume dependency.
- **Settings API** — `/agent` and `/team` chat commands read from disk.
- **Configurable API base URL** — would remove the need for
  `network_mode: "service:core"`.
- **Remote agent dispatch** — a `remote` provider type in `invoke.ts`
  that POSTs to a worker URL instead of spawning a local CLI.
  Would allow core's queue to dispatch directly to isolated workers.

## License

MIT
