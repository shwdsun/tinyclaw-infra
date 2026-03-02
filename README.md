# tinyclaw-infra

Infrastructure layer for [TinyClaw](https://github.com/TinyAGI/tinyclaw).

> This repo will be made public once ready for use.
> Expecting by end of week, Feb 23 2026.

## Overview

TinyClaw keeps its core simple on purpose. This repo builds on top of that,
solving the problems that show up when you try to run it seriously:

- Security — API authentication via reverse proxy, access control
- Deployment — containerized, reproducible, no manual tmux setup
- Stability — process isolation, restart policies, health checks
- Persistence — volume management for SQLite, files, and agent workspaces

And likely more down the road — monitoring, scaling, multi-node — as the
needs come up.

TinyClaw works fine without this. This module is for when "fine" isn't enough.

## Design

TinyClaw already exposes an HTTP API (Hono, port 3777). Channel clients
(Discord, Telegram, WhatsApp) communicate with the core via this API.
This repo does not modify TinyClaw's code. It wraps it.

### Container topology

```
                 ┌──────────────────────────────────┐
  external       │         auth-proxy (:8080)        │
  requests ────► │  Bearer token auth, forwarding    │
                 └──────────────┬───────────────────┘
                                │
                 ┌──────────────▼───────────────────┐
                 │    tinyclaw-core (:3777)          │
                 │    queue-processor + API + SQLite  │
                 │                                    │
                 │    channel clients share this      │
                 │    network (localhost:3777)         │
                 └──────────────────────────────────┘
```

- **auth-proxy**: Reverse proxy that authenticates external requests
  before forwarding to TinyClaw's API. TinyClaw itself stays unmodified.
- **tinyclaw-core**: Stock TinyClaw in a container with health checks
  and `restart: unless-stopped`. SQLite DB and workspaces on Docker
  volumes.
- **channel clients**: Each runs in its own container but shares the
  core's network namespace (`network_mode: "service:core"`) so
  `localhost:3777` works without modifying tinyclaw. Enabled via
  compose profiles.

### Key decisions

**Why `network_mode: "service:core"` instead of separate networks?**
TinyClaw's channel clients hardcode `http://localhost:${API_PORT}` as
the API base. Rather than forking tinyclaw to make this configurable,
channel containers share the core's network namespace. This means
`localhost:3777` resolves to the core's API from within channel
containers, zero code changes needed.

**Why no Redis?**
TinyClaw already migrated from file-based queues to SQLite with WAL
mode, retry logic, dead letter queue, and crash recovery. Single-node,
SQLite is simpler and has no external dependencies. Redis becomes
relevant only for multi-node deployments, which is not the current
scope.

## Usage

Requires Docker with Compose v2.17+ (for `additional_contexts`).

```bash
git clone https://github.com/TinyAGI/tinyclaw.git
git clone https://github.com/shwdsun/tinyclaw-infra.git

cd tinyclaw-infra
cp .env.example .env
# Edit .env: set API_KEY, add AI provider key, add bot tokens
```

Start core + auth proxy:

```bash
docker compose up -d
```

Enable a channel (e.g. telegram):

```bash
docker compose --profile telegram up -d
```

Enable all channels:

```bash
docker compose --profile all up -d
```

Verify:

```bash
docker compose ps
curl http://localhost:8080/api/queue/status \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Repo structure

```
tinyclaw-infra/
├── docker/
│   ├── Dockerfile.core         # Queue processor + API + SQLite
│   ├── Dockerfile.channel      # Discord / Telegram client
│   ├── Dockerfile.whatsapp     # WhatsApp client (needs chromium)
│   └── Dockerfile.proxy        # Auth reverse proxy
├── proxy/
│   └── index.js                # Proxy implementation (zero deps)
├── docker-compose.yml
├── .env.example
└── README.md
```

## Upstream improvements

These are not blockers — workarounds exist — but would be cleaner
if contributed to TinyClaw:

- **Pairing API**: Channel clients import `pairing.ts` directly.
  Adding `/api/pairing/check` and `/api/pairing/approve` endpoints
  would remove the need for a shared volume for `pairing.json`.
- **Settings API for chat commands**: `/agent` and `/team` commands
  read `settings.json` from disk instead of using the existing API.
- **Configurable API base URL**: Would eliminate the need for
  `network_mode: "service:core"`.

## Status

Waiting on TinyClaw to land its provider interfaces.
Expecting to open this repo by end of week, Feb 23 2026.

## License

MIT
