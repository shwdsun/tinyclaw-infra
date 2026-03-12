# tinyclaw-infra

Deployment layer for [TinyClaw](https://github.com/TinyAGI/tinyclaw). Adds containerisation, an auth/proxy gateway, worker isolation, and Prometheus metrics — without touching TinyClaw source.

## Architecture

```
                    ┌─────────────────────────┐
                    │      gateway :8080       │
        ───────────►│  auth  proxy  dispatch   │
                    │  /metrics (prometheus)   │
                    └────────┬──────────┬──────┘
                             │          │
               core network  │          │  worker network
                             │          │
              ┌──────────────▼──┐  ┌────▼──────────────┐
              │  tinyclaw-core  │  │  worker-coder      │
              │  :3777          │  │  worker-reviewer   │
              │                 │  │  remote workers    │
              │  discord  ─┐    │  └───────────────────┘
              │  telegram ─┤    │
              │  whatsapp ─┘    │
              └─────────────────┘
```

Traffic enters through the gateway. Workers are isolated on a separate network and can only reach the gateway. Channel clients share the core's network namespace so they can hit `localhost:3777` without configuration changes to TinyClaw.

## Requirements

- Docker with Compose v2.17+ (`additional_contexts` support)
- TinyClaw repo checked out alongside this one (or set `TINYCLAW_PATH`)
- At least one AI provider CLI installed in the worker image, or configured as a custom provider

## Quick start

```bash
git clone https://github.com/TinyAGI/tinyclaw.git
git clone https://github.com/shwdsun/tinyclaw-infra.git

cd tinyclaw-infra
cp .env.example .env
# set API_KEY and any provider keys / bot tokens
```

Build and start core, gateway, Prometheus:

```bash
docker compose build
docker compose up -d
```

Enable a channel:

```bash
docker compose --profile telegram up -d
docker compose --profile discord up -d
docker compose --profile whatsapp up -d
docker compose --profile all up -d
```

Verify:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" http://localhost:8080/api/queue/status
```

Prometheus is at `http://localhost:9090`.

## Configuration

Copy `.env.example` to `.env` and fill in the values:

| Variable | Required | Description |
|----------|----------|-------------|
| `API_KEY` | yes | Bearer token for gateway auth |
| `TINYCLAW_PATH` | no | Path to tinyclaw repo (default: `../tinyclaw`) |
| `GATEWAY_PORT` | no | Host port for gateway (default: 8080) |
| `PROMETHEUS_PORT` | no | Host port for Prometheus (default: 9090) |
| `DISCORD_BOT_TOKEN` | discord profile | Discord bot token |
| `TELEGRAM_BOT_TOKEN` | telegram profile | Telegram bot token |

Provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) are passed through to the core container and used by TinyClaw's settings. You can also configure them in `~/.tinyclaw/settings.json` via the `models` key.

## Workers

Workers run agent invocations in isolated containers. Each worker polls the gateway for tasks, spawns the configured provider CLI, and returns the result.

Define workers in `docker-compose.override.yml` (preferred) or uncomment the examples in `docker-compose.yml`:

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
  volumes:
    - coder-workspace:/workspace
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
    - MODEL=sonnet
  volumes:
    - coder-workspace:/workspace:ro
  networks:
    - workers
```

Workers only have access to the `workers` network. They cannot reach the core or channel containers.

### Remote workers

Any process that implements the worker protocol can run anywhere (Railway, VM, laptop):

```bash
GATEWAY_URL=https://your-gateway.example.com \
API_KEY=your-key \
AGENT_ID=coder \
PROVIDER=anthropic \
node worker/index.js
```

## Worker protocol

### Submit a task

```
POST /api/tasks
Authorization: Bearer <API_KEY>

{ "agent": "coder", "message": "refactor auth module", "metadata": {} }

201 { "id": "1", "agent": "coder", "status": "pending", ... }
```

### Claim a task (worker → gateway)

```
POST /api/tasks/claim
Authorization: Bearer <API_KEY>

{ "agent": "coder" }

200 { "id": "1", "message": "...", "status": "claimed", ... }
204  (no pending tasks for this agent)
```

### Submit result (worker → gateway)

```
POST /api/tasks/<id>/result
Authorization: Bearer <API_KEY>

{ "result": "done" }
  or
{ "error": "exit code 1" }

200 { "id": "1", "status": "completed", ... }
```

### Query tasks

```
GET /api/tasks            all tasks
GET /api/tasks/<id>       single task
GET /api/tasks?status=pending
```

### Task lifecycle

```
pending ──► claimed ──► completed
                   └──► failed

stale claimed tasks (>10 min) reset to pending automatically
completed/failed tasks pruned after 1 hour
```

## Observability

`GET /metrics` on the gateway returns Prometheus text format (no auth required).

**Gateway**

| Metric | Type | Labels |
|--------|------|--------|
| `gateway_requests_total` | counter | `path`, `status` |
| `gateway_tasks_created_total` | counter | `agent` |
| `gateway_tasks_claimed_total` | counter | `agent` |
| `gateway_tasks_resolved_total` | counter | `agent`, `status` |
| `gateway_tasks_pending` | gauge | — |
| `gateway_tasks_claimed` | gauge | — |

**Workers** — each worker exposes `:9100/metrics`

| Metric | Type | Labels |
|--------|------|--------|
| `worker_tasks_total` | counter | `agent`, `status` |
| `worker_busy` | gauge | `agent` |

## Repo structure

```
tinyclaw-infra/
├── docker/
│   ├── Dockerfile.core       queue processor + API
│   ├── Dockerfile.gateway    gateway (alpine, no npm deps)
│   ├── Dockerfile.worker     isolated agent runtime
│   ├── Dockerfile.channel    Discord / Telegram client
│   └── Dockerfile.whatsapp   WhatsApp client (chromium)
├── gateway/
│   ├── index.js              HTTP server, auth, routing
│   ├── proxy.js              reverse proxy to core
│   ├── tasks.js              in-memory task queue
│   └── metrics.js            Prometheus metrics
├── worker/
│   └── index.js              poll → execute → submit loop
├── monitoring/
│   └── prometheus.yml        scrape config
├── docker-compose.yml
└── .env.example
```

## Design notes

**`network_mode: "service:core"` for channel clients** — TinyClaw channel clients connect to `localhost:${API_PORT}`. Sharing the core container's network namespace is the cleanest way to support this without forking TinyClaw.

**`network: host` on builds** — hosts running systemd-resolved expose DNS at `127.0.0.53`, which is unreachable from inside a build container (different network namespace). Setting `network: host` on the build stage gives the build container direct access to the host's DNS resolver. This only affects build time; runtime networking is unaffected.

**Two networks** — `core` for TinyClaw internals, `workers` for agent execution. The gateway bridges both. Workers are network-isolated from the core by design.

**In-memory task queue in gateway** — tasks are ephemeral dispatch units. TinyClaw's SQLite queue is the source of truth for message state; the gateway queue only tracks the inflight worker handoff.

**Zero-dependency gateway** — Node.js built-ins only. No npm install, no supply chain surface.

## License

MIT
