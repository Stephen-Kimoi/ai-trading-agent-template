import axios from "axios";
import { MarketData } from "../types/index";

// Map your trading pair → CoinGecko ID
function mapPairToCoin(pair: string): string {
  const normalized = pair.toUpperCase();

  if (normalized === "BTCUSD" || normalized === "XBTUSD") return "bitcoin";
  if (normalized === "ETHUSD") return "ethereum";

  throw new Error(`Unsupported pair for CoinGecko: ${pair}`);
}

export async function getMarketSnapshot(pair: string): Promise<MarketData> {
  const coinId = mapPairToCoin(pair);

  try {
    const res = await axios.get(
      `https://api.coingecko.com/api/v3/coins/${coinId}`,
      {
        params: {
          localization: false,
          tickers: false,
          market_data: true,
        },
      }
    );

    const marketData = res.data.market_data;

    const price = marketData.current_price.usd;
    const volume = marketData.total_volume.usd;

    // Simulated spread
    const spreadPct = 0.002;
    const bid = price * (1 - spreadPct);
    const ask = price * (1 + spreadPct);

    return {
      price,
      volume,
      bid,
      ask,
      pair,
      vwap: price,              // simple fallback VWAP
      high: marketData.high_24h.usd,
      low: marketData.low_24h.usd,
      timestamp: Date.now(),
    };

  } catch (error) {
    console.error("[marketdata] CoinGecko fetch failed:", error);

    return {
      price: 0,
      volume: 0,
      bid: 0,
      ask: 0,
      pair,
      vwap: 0,
      high: 0,
      low: 0,
      timestamp: Date.now(),
    };
  }
}