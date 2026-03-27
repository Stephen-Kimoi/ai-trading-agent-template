# Part 3: Connecting to Kraken CLI

## Why the CLI, not raw REST?

The Kraken CLI is the correct integration point for this hackathon challenge. It handles all exchange plumbing automatically:

- Cryptographic nonce management (no clock drift issues)
- HMAC-SHA512 request signing (no manual auth code)
- Rate-limit retries (no 429 handling needed)
- Built-in paper trading sandbox (`--sandbox` flag)
- **Built-in MCP server** — exposes Kraken as structured tools for AI agents

---

## Installing the Kraken CLI

```bash
# Option A: install script (Linux/macOS)
curl -sSL https://github.com/kraken-oss/kraken-cli/releases/latest/download/install.sh | sh

# Option B: download binary from GitHub releases
# https://github.com/kraken-oss/kraken-cli/releases

# Verify installation
kraken --version
```

Add to your `.env`:
```env
KRAKEN_API_KEY=your_api_key
KRAKEN_API_SECRET=your_api_secret
KRAKEN_SANDBOX=true          # start with sandbox!
KRAKEN_CLI_PATH=kraken       # only needed if binary isn't on PATH
```

---

## Getting Kraken API keys

1. Log into [kraken.com](https://kraken.com) → choose **Kraken Pro** (Advanced trading)
2. Go to **Settings → API** and create a new key
3. Tick exactly these permissions:

**Funds permissions**
- ✅ Query — required for `getBalance()`

**Orders and trades**
- ✅ Query open orders & trades — required for `getOpenOrders()`
- ✅ Create & modify orders — required for `placeOrder()`
- ✅ Cancel & close orders — required if the agent needs to cancel orders

Leave everything else unchecked (no Deposit, Withdraw, Earn, Data, or WebSocket).

4. Copy the key + secret into `.env`

---

## Using the CLI directly

The CLI is useful to verify your setup before running the agent:

```bash
# Check ticker (no auth needed)
kraken --json ticker --pair XBTUSD

# Check balance (requires API key)
kraken --json --api-key $KRAKEN_API_KEY --api-secret $KRAKEN_API_SECRET balance

# Paper trade (sandbox mode)
kraken --sandbox --json --api-key $KRAKEN_API_KEY --api-secret $KRAKEN_API_SECRET \
  order add --pair XBTUSD --type buy --ordertype market --volume 0.001
```

---

## How the TypeScript client wraps the CLI

`src/exchange/kraken.ts` spawns the CLI as a subprocess:

```typescript
private async run(subcommand: string[], isPrivate = false): Promise<unknown> {
  const args = ["--json"];
  if (this.sandbox)  args.push("--sandbox");
  if (isPrivate)     args.push("--api-key", this.apiKey, "--api-secret", this.apiSecret);
  args.push(...subcommand);

  const { stdout } = await execFileAsync(KRAKEN_BIN, args);
  return JSON.parse(stdout.trim());
}
```

All three public methods use this:

```typescript
// Fetch market data
const market = await kraken.getTicker("XBTUSD");
// → { price: 95420.5, bid: 95418, ask: 95423, volume: 1204, ... }

// Place order (paper trade in sandbox)
const result = await kraken.placeOrder({
  pair: "XBTUSD", type: "buy", ordertype: "market", volume: "0.001"
});
// → { txid: ["OTXID-..."], descr: { order: "buy 0.001 XBTUSD @ market" } }
```

---

## MCP server mode (alternative)

The CLI ships with a built-in MCP server — the preferred integration for agents that already use the Model Context Protocol:

```bash
# Start the MCP server
kraken mcp serve --port 8080
```

Then use `KrakenMCPClient` in `src/exchange/kraken.ts`:

```typescript
import { KrakenMCPClient } from "./src/exchange/kraken.js";
const kraken = new KrakenMCPClient(8080);

// Same interface as KrakenClient
const market = await kraken.getTicker("XBTUSD");
```

This is the cleanest approach for LangChain/Claude tool-use integrations, since the MCP server exposes Kraken operations as first-class tools.

---

## Sandbox vs. live

| Setting | Behavior |
|---------|----------|
| `KRAKEN_SANDBOX=true` | Paper trading — orders logged but not executed |
| `KRAKEN_SANDBOX=false` | Live trading — real funds, real orders |

The agent reads this at startup. No code changes needed to switch modes.

---

## Template note

> **For hackathon teams:** The `KrakenClient` is the exchange adapter layer. Your strategy returns a `TradeDecision` — the agent loop calls `placeOrder()` automatically. You never touch the CLI directly.

---

→ [Part 4: The Vault, Risk Router, and TradeIntent Pattern](./04-vault-riskrouter.md)
