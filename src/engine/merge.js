// 手動転記値 × RPC推計値のフィールド単位マージ（DESIGN.md §0.2 / 6.1）
// manual を優先し、欠けているフィールドのみ rpc で補完する

const FIELDS = [
  "avgHoldingHours",
  "winRate",
  "dailyTrades",
  "tradeCount30d",
  "realizedPnlUsd",
  "unrealizedPnlUsd",
  "shortTermRatio",
  "monthlyPnl",
];

export function mergeStats(manual, rpc) {
  const out = {
    address: manual?.address ?? rpc?.address ?? "",
    label: manual?.label ?? rpc?.label ?? null,
    source: manual && rpc ? "merged" : manual ? "manual" : "rpc",
    fetchedAt: rpc?.fetchedAt ?? new Date().toISOString(),
  };
  for (const f of FIELDS) {
    const m = manual?.[f];
    out[f] = m != null && m !== "" ? m : (rpc?.[f] ?? null);
  }
  return out;
}

/** /api/wallet レスポンスの data 部を TraderStats に正規化 */
export function rpcToStats(address, d) {
  if (!d) return null;
  const buy = num(d.buy_30d);
  const sell = num(d.sell_30d);
  const tradeCount = num(d.trade_count_30d) ?? (buy != null || sell != null ? (buy ?? 0) + (sell ?? 0) : null);
  return {
    address,
    label: null,
    avgHoldingHours: num(d.avg_hold_duration),
    winRate: num(d.winrate),
    dailyTrades: num(d.daily_trades) ?? (tradeCount != null ? tradeCount / 30 : null),
    tradeCount30d: tradeCount,
    realizedPnlUsd: num(d.realized_profit),
    unrealizedPnlUsd: num(d.unrealized_profit),
    shortTermRatio: num(d.short_term_ratio),
    monthlyPnl: Array.isArray(d.monthly_pnl) ? d.monthly_pnl : null,
    source: "rpc",
    fetchedAt: new Date().toISOString(),
  };
}

function num(x) {
  if (x == null || x === "") return null;
  const n = typeof x === "number" ? x : parseFloat(x);
  return Number.isFinite(n) ? n : null;
}
