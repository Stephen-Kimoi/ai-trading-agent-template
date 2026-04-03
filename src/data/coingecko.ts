import axios from "axios";
import { MarketData } from "../types";

export async function fetchCoinGeckoData(pair: string): Promise<MarketData> {
  // BTCUSD → bitcoin
  const symbol = pair.replace("USD", "").toLowerCase();

  // map symbols → coingecko ids
  const map: Record<string, string> = {
    btc: "bitcoin",
    eth: "ethereum",
    sol: "solana",
  };

  const id = map[symbol];
  if (!id) throw new Error(`Unsupported asset: ${symbol}`);

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_vol=true`;

  const res = await axios.get(url);

  const data = res.data[id];

  if (!data) throw new Error("CoinGecko data missing");

  const price = data.usd;
  const volume = data.usd_24h_vol;

  return {
    pair,
    price,
    bid: price * 0.999, // simulate spread
    ask: price * 1.001,
    volume: volume ?? 1000000,
    vwap: price,
    high: price * 1.01,
    low: price * 0.99,
    timestamp: Date.now(),
  };
}