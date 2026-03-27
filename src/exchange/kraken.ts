/**
 * Kraken CLI client
 *
 * Wraps the Kraken CLI binary (https://github.com/kraken-oss/kraken-cli) instead
 * of rolling our own HTTP/HMAC client. The CLI handles all exchange plumbing:
 *   - Cryptographic nonce management
 *   - HMAC-SHA512 request signing
 *   - Rate-limit retries
 *   - Paper-trading sandbox (--sandbox flag)
 *
 * Prerequisites:
 *   1. Install the Kraken CLI:
 *      curl -sSL https://github.com/kraken-oss/kraken-cli/releases/latest/download/install.sh | sh
 *      (or download the binary for your platform from the releases page)
 *   2. Set KRAKEN_API_KEY and KRAKEN_API_SECRET in .env
 *   3. Set KRAKEN_SANDBOX=true for paper trading
 *
 * The CLI also ships with a built-in MCP server for AI agent integration.
 * See the KrakenMCPClient below for the MCP-based approach.
 *
 * CLI docs: https://github.com/kraken-oss/kraken-cli
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { KrakenOrder, KrakenOrderResult, MarketData } from "../types/index";

const execFileAsync = promisify(execFile);

// Path to the kraken CLI binary. Override with KRAKEN_CLI_PATH env var
// if the binary is not on PATH.
const KRAKEN_BIN = process.env.KRAKEN_CLI_PATH || "kraken";

export class KrakenClient {
  private readonly sandbox: boolean;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor() {
    this.sandbox = process.env.KRAKEN_SANDBOX === "true";
    this.apiKey = process.env.KRAKEN_API_KEY || "";
    this.apiSecret = process.env.KRAKEN_API_SECRET || "";

    if (!this.apiKey || !this.apiSecret) {
      console.warn("[kraken] No API credentials set — private commands will fail");
    }
    if (this.sandbox) {
      console.log("[kraken] Running in SANDBOX (paper trading) mode");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Core CLI runner
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute a Kraken CLI command and return parsed JSON output.
   *
   * The CLI is invoked as:
   *   kraken [--sandbox] [--api-key KEY --api-secret SECRET] <subcommand> [args...]
   *
   * All output is JSON by default when --json flag is passed.
   */
  private async run(subcommand: string[], isPrivate = false): Promise<unknown> {
    const args: string[] = [];

    if (isPrivate && !this.sandbox) {
      args.push("--api-key", this.apiKey, "--api-secret", this.apiSecret);
    }

    args.push(...subcommand);
    args.push("-o", "json");

    try {
      const { stdout } = await execFileAsync(KRAKEN_BIN, args, { timeout: 15000 });
      return JSON.parse(stdout.trim());
    } catch (err: unknown) {
      // If CLI binary not found, surface a helpful error
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `[kraken] Kraken CLI binary not found at "${KRAKEN_BIN}".\n` +
          `Install it from https://github.com/kraken-oss/kraken-cli or set KRAKEN_CLI_PATH`
        );
      }
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Market data (public — no auth)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch live ticker data for a trading pair.
   *
   * CLI equivalent:
   *   kraken --json ticker --pair XBTUSD
   */
  async getTicker(pair: string): Promise<MarketData> {
    const result = await this.run(["ticker", pair]) as KrakenTickerResponse;

    // CLI returns data directly (no result wrapper): { "XXBTZUSD": { a, b, c, ... } }
    type TickerEntry = { a?: string[]; b?: string[]; c?: string[]; v?: string[]; p?: string[]; h?: string[]; l?: string[]; last?: string; price?: string; bid?: string; ask?: string; volume?: string; vwap?: string; high?: string; low?: string; };
    const data = (result.result ?? result) as Record<string, TickerEntry>;
    const t = data[pair] ?? data[Object.keys(data)[0]];
    if (!t) throw new Error(`[kraken] No ticker data for pair: ${pair}`);

    return {
      pair,
      price: parseFloat(t.c?.[0] ?? t.last ?? t.price ?? "0"),
      bid:   parseFloat(t.b?.[0] ?? t.bid ?? "0"),
      ask:   parseFloat(t.a?.[0] ?? t.ask ?? "0"),
      volume: parseFloat(t.v?.[1] ?? t.volume ?? "0"),
      vwap:   parseFloat(t.p?.[1] ?? t.vwap ?? "0"),
      high:   parseFloat(t.h?.[1] ?? t.high ?? "0"),
      low:    parseFloat(t.l?.[1] ?? t.low ?? "0"),
      timestamp: Date.now(),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Trading (private — requires API key)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Place a market or limit order.
   *
   * CLI equivalent:
   *   kraken --json order add --pair XBTUSD --type buy --ordertype market --volume 0.001
   *
   * In sandbox mode the CLI uses paper trading — no real funds are affected.
   */
  async placeOrder(order: KrakenOrder): Promise<KrakenOrderResult> {
    let args: string[];
    if (this.sandbox) {
      // Paper trading: kraken paper buy <PAIR> <VOL> [--type limit --price P]
      args = ["paper", order.type, order.pair, order.volume];
      if (order.ordertype === "limit" && order.price) args.push("--type", "limit", "--price", order.price);
    } else {
      args = ["order", "buy" === order.type ? "buy" : "sell", order.pair, order.volume, "--type", order.ordertype];
      if (order.price) args.push("--price", order.price);
    }

    const result = await this.run(args, !this.sandbox) as KrakenOrderResponse;

    if (result.error?.length) {
      throw new Error(`[kraken] Order error: ${result.error.join(", ")}`);
    }

    return {
      txid: result.result?.txid ?? [`${this.sandbox ? "SANDBOX" : "ORDER"}-${Date.now()}`],
      descr: result.result?.descr ?? { order: `${order.type} ${order.volume} ${order.pair}` },
    };
  }

  /**
   * Get open orders.
   *
   * CLI equivalent:
   *   kraken --json order list
   */
  async getOpenOrders(): Promise<Record<string, unknown>> {
    const result = await this.run(["order", "list"], true) as { result?: Record<string, unknown> };
    return result.result ?? {};
  }

  /**
   * Get account balance.
   *
   * CLI equivalent:
   *   kraken --json balance
   */
  async getBalance(): Promise<Record<string, string>> {
    const result = await this.run(["balance"], true) as { result?: Record<string, string> };
    return result.result ?? {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Kraken MCP client (alternative — for agents using the MCP protocol directly)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Kraken CLI ships with a built-in MCP server that exposes Kraken operations
 * as structured tools for AI agents. This is the preferred integration if your
 * agent already uses the Model Context Protocol.
 *
 * Start the MCP server:
 *   kraken mcp serve --port 8080
 *
 * The server exposes tools like:
 *   - kraken_ticker   { pair: string }
 *   - kraken_balance  {}
 *   - kraken_order    { pair, type, ordertype, volume }
 *
 * For LangChain/Claude tool use, wire the MCP server as a tool provider.
 * For direct use, call the MCP server via HTTP as shown below.
 *
 * See: https://github.com/kraken-oss/kraken-cli#mcp-server
 */
export class KrakenMCPClient {
  private readonly baseUrl: string;

  constructor(port = 8080) {
    this.baseUrl = `http://localhost:${port}`;
    console.log(`[kraken-mcp] Connecting to MCP server at ${this.baseUrl}`);
    console.log(`[kraken-mcp] Start server with: kraken mcp serve --port ${port}`);
  }

  /**
   * Call a tool on the MCP server.
   */
  async callTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
    // Dynamic import to keep axios optional if only CLI mode is used
    const axios = (await import("axios")).default;
    const { data } = await axios.post(`${this.baseUrl}/tools/${toolName}`, params);
    return data;
  }

  async getTicker(pair: string): Promise<MarketData> {
    const result = await this.callTool("kraken_ticker", { pair }) as KrakenTickerResponse;
    const t = result.result?.[pair] ?? result.result?.[Object.keys(result.result ?? {})[0]];
    if (!t) throw new Error(`[kraken-mcp] No ticker data for pair: ${pair}`);
    return {
      pair,
      price: parseFloat(t.c?.[0] ?? t.last ?? "0"),
      bid: parseFloat(t.b?.[0] ?? t.bid ?? "0"),
      ask: parseFloat(t.a?.[0] ?? t.ask ?? "0"),
      volume: parseFloat(t.v?.[1] ?? t.volume ?? "0"),
      vwap: parseFloat(t.p?.[1] ?? t.vwap ?? "0"),
      high: parseFloat((t.h?.[1] ?? (t as Record<string, unknown>).high ?? "0") as string),
      low: parseFloat((t.l?.[1] ?? (t as Record<string, unknown>).low ?? "0") as string),
      timestamp: Date.now(),
    };
  }

  async placeOrder(order: KrakenOrder): Promise<KrakenOrderResult> {
    const result = await this.callTool("kraken_order", { ...order }) as KrakenOrderResponse;
    return {
      txid: result.result?.txid ?? [`MCP-${Date.now()}`],
      descr: result.result?.descr ?? { order: `${order.type} ${order.volume} ${order.pair}` },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal types for CLI response shapes
// ─────────────────────────────────────────────────────────────────────────────

interface KrakenTickerResponse {
  error?: string[];
  result?: Record<string, {
    a?: string[]; b?: string[]; c?: string[]; v?: string[];
    p?: string[]; h?: string[]; l?: string[];
    last?: string; price?: string; bid?: string; ask?: string; volume?: string; vwap?: string; high?: string; low?: string;
  }>;
}

interface KrakenOrderResponse {
  error?: string[];
  result?: {
    txid: string[];
    descr: { order: string };
  };
}
