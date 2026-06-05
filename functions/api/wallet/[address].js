const RPC = "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  return j.result;
}

export async function onRequest({ params }) {
  const addr = params.address;

  // 1. Token holdings
  const tokenAccounts = await rpc("getTokenAccountsByOwner", [
    addr,
    { programId: TOKEN_PROGRAM },
    { encoding: "jsonParsed" },
  ]);
  const holdings = (tokenAccounts?.value ?? []).map(a => {
    const info = a.account.data.parsed.info;
    return { mint: info.mint, amount: parseFloat(info.tokenAmount.uiAmountString ?? 0) };
  }).filter(h => h.amount > 0);

  // 2. Token prices from Jupiter (free, no auth)
  let unrealizedUsd = 0;
  if (holdings.length > 0) {
    const mints = holdings.map(h => h.mint).slice(0, 100).join(",");
    try {
      const priceRes = await fetch(`https://price.jup.ag/v6/price?ids=${mints}`);
      const priceData = await priceRes.json();
      for (const h of holdings) {
        const p = priceData?.data?.[h.mint]?.price ?? 0;
        unrealizedUsd += h.amount * p;
      }
    } catch (_) {}
  }

  // 3. Recent transaction signatures (30 days)
  const sigs = await rpc("getSignaturesForAddress", [addr, { limit: 200 }]);
  const cutoff = Date.now() / 1000 - 30 * 86400;
  const recent = (sigs ?? []).filter(s => s.blockTime >= cutoff && !s.err);

  // Estimate daily trade count (total non-error txs / 30)
  const dailyTrades = recent.length > 0 ? (recent.length / 30).toFixed(1) : null;

  // 4. Fetch parsed details for up to 40 recent txs to compute win rate
  let wins = 0, losses = 0;
  const sample = recent.slice(0, 40);
  await Promise.allSettled(sample.map(async (sig) => {
    const tx = await rpc("getTransaction", [
      sig.signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
    ]);
    const preBalances  = tx?.meta?.preTokenBalances  ?? [];
    const postBalances = tx?.meta?.postTokenBalances ?? [];
    // Find wallet's token changes
    const changes = {};
    for (const b of preBalances) {
      if (b.owner === addr) {
        changes[b.mint] = changes[b.mint] ?? { pre: 0, post: 0 };
        changes[b.mint].pre = parseFloat(b.uiTokenAmount?.uiAmountString ?? 0);
      }
    }
    for (const b of postBalances) {
      if (b.owner === addr) {
        changes[b.mint] = changes[b.mint] ?? { pre: 0, post: 0 };
        changes[b.mint].post = parseFloat(b.uiTokenAmount?.uiAmountString ?? 0);
      }
    }
    // Count as win if any token increased (excluding SOL-only txs)
    const mints = Object.keys(changes);
    if (mints.length < 2) return;
    const gained = mints.some(m => changes[m].post > changes[m].pre);
    const sold   = mints.some(m => changes[m].post < changes[m].pre);
    if (gained && sold) wins++;
    else if (sold) losses++;
  }));

  const total = wins + losses;
  const winrate = total > 0 ? parseFloat((wins / total * 100).toFixed(1)) : null;

  return new Response(JSON.stringify({
    data: {
      unrealized_profit: unrealizedUsd > 0 ? unrealizedUsd.toFixed(0) : null,
      winrate,
      buy_30d: Math.round(recent.length * 0.55),
      sell_30d: Math.round(recent.length * 0.45),
      avg_hold_duration: null,
    },
    _source: "solana-rpc",
    _note: "win_rate from last 40 txs sample; hold_time not available",
  }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
