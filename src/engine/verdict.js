// 評価パイプライン（DESIGN.md §3.1）— エンジンの唯一の公開エントリポイント

import { runGates } from "./gates.js";
import { classify } from "./classify.js";
import { componentScores, totalScore, gradeOf } from "./score.js";
import { buildReasons } from "./reasons.js";

const CORE_METRICS = [
  "avgHoldingHours",
  "winRate",
  "dailyTrades",
  "unrealizedPnlUsd",
  "monthlyPnl",
];

const GATE_JA = {
  G1_SCALP_HOLD: "G1保有時間",
  G2_SCALP_RATIO: "G2短期比率",
  G3_UNDERWATER: "G3含み損",
  G4_FAKE_WINRATE: "G4偽陽性勝率",
  G5_OVERTRADING: "G5過剰取引",
};

/**
 * @param {TraderStats} stats
 * @param {{buySOL:number, slPct:number, tpPct:number|null}} rules
 * @returns {Verdict}
 */
export function evaluate(stats, rules) {
  const evaluatedAt = new Date().toISOString();
  const strategyType = classify(stats);

  // (1) データ充足チェック
  const nullCount = CORE_METRICS.filter((k) => stats[k] == null).length;
  if (
    (stats.tradeCount30d != null && stats.tradeCount30d < 5) ||
    nullCount >= 3
  ) {
    const base = {
      decision: "INSUFFICIENT_DATA",
      strategyType: "UNKNOWN",
      gate: { passed: true, failures: [], skipped: [] },
      warnings: [],
    };
    return {
      ...base,
      score: emptyScore(),
      reasonsJa: buildReasons(base, emptyScore(), stats, rules),
      evaluatedAt,
    };
  }

  // (2) NG ゲート
  const gate = runGates(stats);
  if (!gate.passed) {
    const base = { decision: "NG", strategyType, gate, warnings: [] };
    const score = { ...emptyScore(), totalScore: 0, grade: "D" };
    return {
      ...base,
      score,
      reasonsJa: buildReasons(base, score, stats, rules),
      evaluatedAt,
    };
  }

  // (4)–(5) 成分スコア・総合
  const components = componentScores(stats);
  const { total, completeness } = totalScore(components);
  if (total == null) {
    const base = {
      decision: "INSUFFICIENT_DATA",
      strategyType,
      gate,
      warnings: [],
    };
    const score = { ...emptyScore(), ...components, dataCompleteness: completeness };
    return {
      ...base,
      score,
      reasonsJa: buildReasons(base, score, stats, rules),
      evaluatedAt,
    };
  }
  const score = {
    ...components,
    totalScore: total,
    grade: gradeOf(total),
    dataCompleteness: completeness,
  };

  // (6) warnings → decision
  const warnings = [];
  for (const g of gate.skipped) {
    warnings.push(`${GATE_JA[g]}が未検証（データ不足）`);
  }
  if (completeness < 0.8) {
    warnings.push("一部指標が未取得（RPC推計のみ）。GMGN画面の値で補完推奨");
  }
  if (!stats.monthlyPnl || stats.monthlyPnl.length < 3) {
    warnings.push("運用履歴が浅い。0.1 SOLでの試験コピー推奨");
  }
  if (strategyType === "BAG_HOLDER") {
    warnings.push("塩漬け傾向。SL到達前の手動監視必須");
  }
  if (stats.avgHoldingHours != null && stats.avgHoldingHours > 45 * 24) {
    warnings.push("保有が長期化傾向。資金回転率に注意");
  }

  let decision;
  if (strategyType === "SCALPING" || strategyType === "GAMBLER") {
    decision = "NG";
  } else if (
    score.grade === "A" ||
    (score.grade === "B" && warnings.length === 0)
  ) {
    decision = "COPY_OK";
  } else if (
    score.grade === "B" ||
    (score.grade === "C" &&
      (strategyType === "SWING_STABLE" || strategyType === "MID_TREND"))
  ) {
    decision = "CONDITIONAL";
  } else {
    decision = "NG";
  }

  const base = { decision, strategyType, gate, warnings };
  return {
    ...base,
    score,
    reasonsJa: buildReasons(base, score, stats, rules),
    evaluatedAt,
  };
}

function emptyScore() {
  return {
    totalScore: null,
    grade: null,
    holdingScore: null,
    stabilityScore: null,
    winRateScore: null,
    riskScore: null,
    executionScore: null,
    dataCompleteness: 0,
  };
}
