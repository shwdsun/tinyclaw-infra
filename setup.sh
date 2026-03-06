#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  tinyclaw-infra — Setup${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

check_cmd() {
    if ! command -v "$1" &>/dev/null; then
        echo -e "${RED}✗ $1 not found. Please install it first.${NC}"
        exit 1
    fi
}

check_cmd docker

COMPOSE_VERSION=$(docker compose version --short 2>/dev/null || echo "0")
COMPOSE_MAJOR=$(echo "$COMPOSE_VERSION" | cut -d. -f1)
COMPOSE_MINOR=$(echo "$COMPOSE_VERSION" | cut -d. -f2)

if [ "$COMPOSE_MAJOR" -lt 2 ] || { [ "$COMPOSE_MAJOR" -eq 2 ] && [ "$COMPOSE_MINOR" -lt 17 ]; }; then
    echo -e "${RED}✗ Docker Compose v2.17+ required (found $COMPOSE_VERSION)${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Docker $(docker --version | grep -oP '\d+\.\d+\.\d+')${NC}"
echo -e "${GREEN}✓ Compose $COMPOSE_VERSION${NC}"
echo ""

TINYCLAW_DEFAULT="../tinyclaw"
if [ -f "$ENV_FILE" ]; then
    EXISTING_PATH=$(grep '^TINYCLAW_PATH=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
fi
TINYCLAW_DEFAULT="${EXISTING_PATH:-$TINYCLAW_DEFAULT}"

echo "Where is the TinyClaw repo?"
echo -e "${YELLOW}(relative or absolute path)${NC}"
read -rp "Path [$TINYCLAW_DEFAULT]: " TINYCLAW_INPUT
TINYCLAW_PATH="${TINYCLAW_INPUT:-$TINYCLAW_DEFAULT}"

# Resolve to absolute
if [[ "$TINYCLAW_PATH" != /* ]]; then
    TINYCLAW_PATH="$(cd "$SCRIPT_DIR" && cd "$TINYCLAW_PATH" 2>/dev/null && pwd)" || true
fi

if [ ! -f "$TINYCLAW_PATH/package.json" ]; then
    echo -e "${RED}✗ TinyClaw not found at $TINYCLAW_PATH${NC}"
    exit 1
fi
echo -e "${GREEN}✓ TinyClaw: $TINYCLAW_PATH${NC}"
echo ""

EXISTING_KEY=""
if [ -f "$ENV_FILE" ]; then
    EXISTING_KEY=$(grep '^API_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
fi

if [ -n "$EXISTING_KEY" ] && [ "$EXISTING_KEY" != "change-me-to-a-random-string" ]; then
    echo -e "API key found: ${YELLOW}${EXISTING_KEY:0:8}...${NC}"
    read -rp "Keep existing key? [Y/n]: " KEEP_KEY
    if [[ "$KEEP_KEY" =~ ^[nN] ]]; then
        EXISTING_KEY=""
    fi
fi

if [ -z "$EXISTING_KEY" ] || [ "$EXISTING_KEY" = "change-me-to-a-random-string" ]; then
    DEFAULT_KEY=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | xxd -p 2>/dev/null || echo "change-me-$(date +%s)")
    read -rp "API key [$DEFAULT_KEY]: " KEY_INPUT
    API_KEY="${KEY_INPUT:-$DEFAULT_KEY}"
else
    API_KEY="$EXISTING_KEY"
fi
echo -e "${GREEN}✓ API key set${NC}"
echo ""

echo "Which AI provider?"
echo ""
echo "  1) Anthropic (Claude)"
echo "  2) OpenAI (Codex)"
echo "  3) Both"
echo "  4) Skip (configure later)"
echo ""
read -rp "Choose [1-4, default: 4]: " PROVIDER_CHOICE

ANTHROPIC_KEY=""
OPENAI_KEY=""

if [ -f "$ENV_FILE" ]; then
    ANTHROPIC_KEY=$(grep '^ANTHROPIC_API_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
    OPENAI_KEY=$(grep '^OPENAI_API_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
fi

if [ "${PROVIDER_CHOICE:-4}" = "1" ] || [ "${PROVIDER_CHOICE:-4}" = "3" ]; then
    if [ -n "$ANTHROPIC_KEY" ]; then
        echo -e "Anthropic key found: ${YELLOW}${ANTHROPIC_KEY:0:12}...${NC}"
        read -rp "Keep it? [Y/n]: " KEEP
        if [[ "$KEEP" =~ ^[nN] ]]; then ANTHROPIC_KEY=""; fi
    fi
    if [ -z "$ANTHROPIC_KEY" ]; then
        read -rp "Anthropic API key: " ANTHROPIC_KEY
    fi
    echo -e "${GREEN}✓ Anthropic configured${NC}"
fi

if [ "${PROVIDER_CHOICE:-4}" = "2" ] || [ "${PROVIDER_CHOICE:-4}" = "3" ]; then
    if [ -n "$OPENAI_KEY" ]; then
        echo -e "OpenAI key found: ${YELLOW}${OPENAI_KEY:0:12}...${NC}"
        read -rp "Keep it? [Y/n]: " KEEP
        if [[ "$KEEP" =~ ^[nN] ]]; then OPENAI_KEY=""; fi
    fi
    if [ -z "$OPENAI_KEY" ]; then
        read -rp "OpenAI API key: " OPENAI_KEY
    fi
    echo -e "${GREEN}✓ OpenAI configured${NC}"
fi
echo ""

echo "Enable messaging channels?"
echo ""

DISCORD_TOKEN=""
TELEGRAM_TOKEN=""

if [ -f "$ENV_FILE" ]; then
    DISCORD_TOKEN=$(grep '^DISCORD_BOT_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
    TELEGRAM_TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
fi

read -rp "  Enable Discord? [y/N]: " ENABLE_DISCORD
if [[ "$ENABLE_DISCORD" =~ ^[yY] ]]; then
    if [ -z "$DISCORD_TOKEN" ]; then
        echo -e "  ${YELLOW}(Get a token at: https://discord.com/developers/applications)${NC}"
        read -rp "  Discord bot token: " DISCORD_TOKEN
    else
        echo -e "  Token found: ${YELLOW}${DISCORD_TOKEN:0:12}...${NC}"
    fi
    echo -e "  ${GREEN}✓ Discord enabled${NC}"
fi

read -rp "  Enable Telegram? [y/N]: " ENABLE_TELEGRAM
if [[ "$ENABLE_TELEGRAM" =~ ^[yY] ]]; then
    if [ -z "$TELEGRAM_TOKEN" ]; then
        echo -e "  ${YELLOW}(Create a bot via @BotFather on Telegram)${NC}"
        read -rp "  Telegram bot token: " TELEGRAM_TOKEN
    else
        echo -e "  Token found: ${YELLOW}${TELEGRAM_TOKEN:0:12}...${NC}"
    fi
    echo -e "  ${GREEN}✓ Telegram enabled${NC}"
fi
echo ""

GATEWAY_PORT="8080"
PROMETHEUS_PORT="9090"

read -rp "Gateway port [8080]: " PORT_INPUT
GATEWAY_PORT="${PORT_INPUT:-8080}"

read -rp "Prometheus port [9090]: " PROM_INPUT
PROMETHEUS_PORT="${PROM_INPUT:-9090}"
echo ""

cat > "$ENV_FILE" <<EOF
# Generated by setup.sh — $(date -u +%Y-%m-%dT%H:%M:%SZ)

API_KEY=$API_KEY
TINYCLAW_PATH=$TINYCLAW_PATH

ANTHROPIC_API_KEY=$ANTHROPIC_KEY
OPENAI_API_KEY=$OPENAI_KEY

DISCORD_BOT_TOKEN=$DISCORD_TOKEN
TELEGRAM_BOT_TOKEN=$TELEGRAM_TOKEN

GATEWAY_PORT=$GATEWAY_PORT
PROMETHEUS_PORT=$PROMETHEUS_PORT
EOF

echo -e "${GREEN}✓ Configuration written to .env${NC}"
echo ""

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Building containers${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

cd "$SCRIPT_DIR"

docker compose build core gateway

PROFILES=""
if [ -n "$DISCORD_TOKEN" ]; then
    docker compose --profile discord build discord
    PROFILES="$PROFILES --profile discord"
fi
if [ -n "$TELEGRAM_TOKEN" ]; then
    docker compose --profile telegram build telegram
    PROFILES="$PROFILES --profile telegram"
fi

echo ""
read -rp "Start services now? [Y/n]: " START_NOW
if [[ ! "$START_NOW" =~ ^[nN] ]]; then
    echo ""
    docker compose $PROFILES up -d

    echo ""
    echo "Waiting for services to become healthy..."
    sleep 5

    # Health check
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer $API_KEY" \
        "http://localhost:$GATEWAY_PORT/api/queue/status" 2>/dev/null || echo "000")

    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✓ Gateway healthy on :${GATEWAY_PORT}${NC}"

        echo ""
        echo "Queue status:"
        curl -s -H "Authorization: Bearer $API_KEY" \
            "http://localhost:$GATEWAY_PORT/api/queue/status" 2>/dev/null | python3 -m json.tool 2>/dev/null || \
        curl -s -H "Authorization: Bearer $API_KEY" \
            "http://localhost:$GATEWAY_PORT/api/queue/status"
    else
        echo -e "${YELLOW}⚠ Gateway not ready yet (HTTP $HTTP_CODE). Check with:${NC}"
        echo "  docker compose ps"
        echo "  docker compose logs core"
        echo "  docker compose logs gateway"
    fi
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Setup complete${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Commands:"
echo -e "  ${GREEN}docker compose up -d${NC}                    Start core, gateway, Prometheus"
echo -e "  ${GREEN}docker compose --profile telegram up -d${NC} Enable Telegram"
echo -e "  ${GREEN}docker compose ps${NC}                       Check status"
echo -e "  ${GREEN}docker compose logs -f core${NC}             View core logs"
echo ""
echo "API / UI:"
echo -e "  ${GREEN}curl -H 'Authorization: Bearer $API_KEY' http://localhost:$GATEWAY_PORT/api/queue/status${NC}"
echo -e "  ${GREEN}curl http://localhost:$GATEWAY_PORT/metrics${NC}"
echo -e "  ${GREEN}http://localhost:$PROMETHEUS_PORT${NC}       Prometheus"
echo ""
