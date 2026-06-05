// Requires BIRDEYE_API_KEY environment variable in Cloudflare Pages settings
export async function onRequest({ params, env }) {
  const addr = params.address;
  const key = env.BIRDEYE_API_KEY;

  if (!key) {
    return json({ error: "BIRDEYE_API_KEY not set" }, 500);
  }

  const headers = {
    Accept: "application/json",
    "X-API-KEY": key,
    "x-chain": "solana",
  };

  // Fetch portfolio (unrealized PnL) and trade stats in parallel
  const [portfolioRes, txRes] = await Promise.all([
    fetch(`https://public-api.birdeye.so/v1/wallet/token_list?wallet=${addr}`, { headers }),
    fetch(`https://public-api.birdeye.so/v1/wallet/tx_list?wallet=${addr}&limit=100&offset=0`, { headers }),
  ]);

  const portfolio = await portfolioRes.json().catch(() => ({}));
  const txData    = await txRes.json().catch(() => ({}));

  // Calculate unrealized PnL from portfolio holdings
  const items = portfolio?.data?.items ?? [];
  const unrealizedUsd = items.reduce((sum, t) => {
    const val = (t.uiAmount ?? 0) * (t.priceUsd ?? 0);
    const cost = t.costBasis ?? 0;
    return sum + (val - cost);
  }, 0);

  // Calculate trade stats from last 100 transactions (30d window)
  const now = Date.now() / 1000;
  const cutoff = now - 30 * 86400;
  const txs = (txData?.data?.items ?? []).filter(t => t.blockUnixTime >= cutoff && t.type === "SWAP");

  const buys  = txs.filter(t => t.side === "buy"  || t.from?.symbol === "SOL");
  const sells = txs.filter(t => t.side === "sell" || t.to?.symbol === "SOL");

  // Win rate: sells where value received > value paid
  const closedTrades = sells.filter(t => t.pnl != null);
  const wins = closedTrades.filter(t => t.pnl > 0).length;
  const winrate = closedTrades.length > 0 ? (wins / closedTrades.length * 100).toFixed(1) : null;

  // Daily trade count
  const dailyTrades = txs.length > 0 ? (txs.length / 30).toFixed(1) : null;

  // Avg hold time — approximate from paired buy/sell timestamps
  // (simplified: not matched by token, just overall spread / trade count)
  const holdDays = null; // requires per-token tracking, skipped for now

  return json({
    data: {
      unrealized_profit: items.length > 0 ? unrealizedUsd.toFixed(0) : null,
      winrate: winrate ? parseFloat(winrate) : null,
      buy_30d: buys.length,
      sell_30d: sells.length,
      avg_hold_duration: holdDays,
    },
    _keys: ["unrealized_profit", "winrate", "buy_30d", "sell_30d", "avg_hold_duration"],
    _source: "birdeye",
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
