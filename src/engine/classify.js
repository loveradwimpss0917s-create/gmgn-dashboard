// トレーダー分類（DESIGN.md §3.5）— 優先順位つき、最初に該当したものを返す

import { cvOf } from "./util.js";
import { riskScore } from "./score.js";

export const STRATEGY_LABELS = {
  SWING_STABLE: "スイング安定型",
  MID_TREND: "中期トレンド型",
  SCALPING: "スキャルピング型",
  BAG_HOLDER: "塩漬け型",
  GAMBLER: "ギャンブル型",
  UNKNOWN: "分類不能（データ不足）",
};

export function classify(stats) {
  const h = stats.avgHoldingHours;
  const wr = stats.winRate;
  const dt = stats.dailyTrades;

  // 1. SCALPING
  if ((h != null && h < 24) || (stats.shortTermRatio != null && stats.shortTermRatio > 0.5)) {
    return "SCALPING";
  }
  // 2. GAMBLER
  if (
    wr != null && wr < 35 &&
    ((dt != null && dt > 5) ||
      (stats.monthlyPnl && stats.monthlyPnl.length >= 2 && cvOf(stats.monthlyPnl) > 1.5))
  ) {
    return "GAMBLER";
  }
  // 3. BAG_HOLDER
  const rs = riskScore(stats.unrealizedPnlUsd, stats.realizedPnlUsd);
  if ((h != null && h > 90 * 24) || (rs != null && rs <= 30)) {
    return "BAG_HOLDER";
  }
  // 4. SWING_STABLE
  if (
    h != null && h >= 7 * 24 && h <= 60 * 24 &&
    dt != null && dt <= 3 &&
    wr != null && wr >= 40 && wr <= 80
  ) {
    return "SWING_STABLE";
  }
  // 5. MID_TREND
  if (h != null && h >= 3 * 24 && h < 7 * 24 && dt != null && dt <= 5) {
    return "MID_TREND";
  }
  return "UNKNOWN";
}
