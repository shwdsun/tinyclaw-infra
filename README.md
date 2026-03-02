# tinyclaw-infra

Infrastructure layer for [TinyClaw](https://github.com/TinyAGI/tinyclaw).

## Overview

TinyClaw keeps its core simple. This repo wraps it with what you need
for real deployment:

- API authentication (reverse proxy, bearer tokens)
- Docker containers instead of manual tmux
- Process isolation, auto-restart, health checks
- Volumes for SQLite, workspaces, session data

TinyClaw runs fine without any of this.

## Design

TinyClaw exposes an HTTP API on port 3777. Channel clients (Discord,
Telegram, WhatsApp) already talk to the core over HTTP. This repo
containerizes everything without modifying TinyClaw code.

### Container topology

```
        ┌────────────────────────────────────┐
        │       auth-proxy (:8080)           │
req ──► │  token auth, forwarding            │
        └─────────────────┬──────────────────┘
                          │
        ┌─────────────────▼──────────────────┐
        │     tinyclaw-core (:3777)          │
        │  queue processor + API + SQLite    │
        │                                    │
        │  channel clients share this        │
        │  network namespace                 │
        └────────────────────────────────────┘
```

- **auth-proxy** — authenticates external requests before forwarding
  to TinyClaw. TinyClaw itself has no auth.
- **tinyclaw-core** — stock TinyClaw with health checks and
  `restart: unless-stopped`. SQLite and workspaces on volumes.
- **channel clients** — each in its own container, sharing the core's
  network namespace (`network_mode: "service:core"`) so
  `localhost:3777` resolves correctly. Enabled via compose profiles.

### Key decisions

**`network_mode: "service:core"`** — TinyClaw channel clients hardcode
`localhost:${API_PORT}` as the API base. Sharing the core's network
namespace avoids forking tinyclaw to make this configurable.

**No Redis** — TinyClaw uses SQLite (WAL mode, retry, dead letter queue).
Single-node, there's nothing Redis would add. It becomes relevant for
multi-node, which isn't the current scope.

## Usage

Requires Docker with Compose v2.17+ (`additional_contexts` support).

```bash
git clone https://github.com/TinyAGI/tinyclaw.git
git clone https://github.com/shwdsun/tinyclaw-infra.git

cd tinyclaw-infra
cp .env.example .env
# edit .env — set API_KEY, provider keys, bot tokens
```

Start core + proxy:

```bash
docker compose up -d
```

Enable a channel:

```bash
docker compose --profile telegram up -d
```

Verify:

```bash
docker compose ps
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:8080/api/queue/status
```

## Repo structure

```
tinyclaw-infra/
├── docker/
│   ├── Dockerfile.core       # queue processor + API + SQLite
│   ├── Dockerfile.channel    # Discord / Telegram
│   ├── Dockerfile.whatsapp   # WhatsApp (chromium)
│   └── Dockerfile.proxy      # auth proxy
├── proxy/
│   └── index.js              # proxy impl, zero deps
├── docker-compose.yml
├── .env.example
└── README.md
```

## Upstream improvements

Not blockers, but would be cleaner upstream:

- **Pairing API** — channel clients import `pairing.ts` directly.
  API endpoints for check/approve would drop the shared volume need.
- **Settings API** — `/agent` and `/team` chat commands read
  `settings.json` from disk.
- **Configurable API base URL** — would remove the need for
  `network_mode: "service:core"`.

## License

MIT
