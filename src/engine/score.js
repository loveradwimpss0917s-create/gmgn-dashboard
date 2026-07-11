// 成分スコアと総合スコア（DESIGN.md §3.3–3.4）

import { piecewiseLinear, cvOf, clamp } from "./util.js";

export const WEIGHTS = {
  holdingScore: 0.35,
  stabilityScore: 0.25,
  winRateScore: 0.15,
  riskScore: 0.15,
  executionScore: 0.1,
};

export const COMPONENT_LABELS = {
  holdingScore: "保有時間",
  stabilityScore: "安定性",
  winRateScore: "勝率品質",
  riskScore: "リスク",
  executionScore: "追随性",
};

const HOLD_ANCHORS = [
  [0, 0], [1, 10], [3, 45], [7, 80], [14, 100], [45, 100], [90, 60], [180, 30],
];

export function holdingScore(avgHoldingHours) {
  if (avgHoldingHours == null) return null;
  const d = Math.min(avgHoldingHours / 24, 180);
  return piecewiseLinear(HOLD_ANCHORS, d);
}

export function stabilityScore(monthlyPnl) {
  if (!monthlyPnl || monthlyPnl.length < 2) return null;
  const posRatio = monthlyPnl.filter((x) => x > 0).length / monthlyPnl.length;
  const cv = cvOf(monthlyPnl);
  return 100 * (0.7 * posRatio + 0.3 * (1 - cv / 2));
}

export function winRateScore(winRate, avgHoldingHours) {
  if (winRate == null) return null;
  if (winRate < 35) return (winRate / 35) * 40;
  if (winRate <= 65) return 40 + ((winRate - 35) / 30) * 60;
  if (winRate < 85) {
    if (avgHoldingHours != null && avgHoldingHours >= 168) return 100;
    return 70;
  }
  return 50;
}

export function riskScore(unrealizedPnlUsd, realizedPnlUsd) {
  if (unrealizedPnlUsd == null) return null;
  const r = unrealizedPnlUsd / Math.max(Math.abs(realizedPnlUsd ?? 0), 1000);
  if (r >= 0) return 100;
  if (r >= -0.1) return 85;
  if (r >= -0.25) return 60;
  if (r >= -0.5) return 30;
  return 0;
}

const EXEC_ANCHORS = [
  [0, 50], [0.2, 80], [0.5, 100], [3, 100], [6, 60], [10, 30], [20, 10],
];

export function executionScore(dailyTrades) {
  if (dailyTrades == null) return null;
  return piecewiseLinear(EXEC_ANCHORS, Math.min(dailyTrades, 20));
}

/** 全成分を計算。null = データ欠損 */
export function componentScores(stats) {
  return {
    holdingScore: holdingScore(stats.avgHoldingHours),
    stabilityScore: stabilityScore(stats.monthlyPnl),
    winRateScore: winRateScore(stats.winRate, stats.avgHoldingHours),
    riskScore: riskScore(stats.unrealizedPnlUsd, stats.realizedPnlUsd),
    executionScore: executionScore(stats.dailyTrades),
  };
}

/** 欠損成分を除外して重みを再正規化（§3.3(f)） */
export function totalScore(components) {
  const entries = Object.entries(WEIGHTS).filter(
    ([k]) => components[k] != null,
  );
  const wSum = entries.reduce((s, [, w]) => s + w, 0);
  if (wSum < 0.5) return { total: null, completeness: wSum };
  const total =
    entries.reduce((s, [k, w]) => s + components[k] * w, 0) / wSum;
  return { total: Math.round(clamp(total, 0, 100)), completeness: wSum };
}

export function gradeOf(total) {
  if (total >= 80) return "A";
  if (total >= 65) return "B";
  if (total >= 50) return "C";
  return "D";
}
