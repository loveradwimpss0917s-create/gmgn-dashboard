// NG ゲート（DESIGN.md §3.2）— OR判定、null指標はスキップして warnings 対象に

const GATES = [
  {
    gateId: "G1_SCALP_HOLD",
    threshold: 24,
    value: (s) => s.avgHoldingHours,
    hit: (v) => v < 24,
    reasonJa: (v) =>
      `平均保有${v.toFixed(1)}時間はスキャルピング域（24時間未満）。コピー時のスリッページ・遅延で構造的に不利`,
  },
  {
    gateId: "G2_SCALP_RATIO",
    threshold: 0.5,
    value: (s) => s.shortTermRatio,
    hit: (v) => v > 0.5,
    reasonJa: (v) =>
      `取引の${Math.round(v * 100)}%が保有1時間未満。実質スキャルパーでコピー追随不能`,
  },
  {
    gateId: "G3_UNDERWATER",
    threshold: -0.5,
    value: (s) =>
      s.unrealizedPnlUsd == null
        ? null
        : s.unrealizedPnlUsd / Math.max(Math.abs(s.realizedPnlUsd ?? 0), 1000),
    hit: (v) => v < -0.5,
    reasonJa: (v) =>
      `含み損が実現益の${Math.round(Math.abs(v) * 100)}%に達している。実現益の見せかけ・隠れ損失パターン`,
  },
  {
    gateId: "G4_FAKE_WINRATE",
    threshold: 85,
    value: (s) =>
      s.winRate == null || s.avgHoldingHours == null
        ? null
        : s.winRate >= 85 && s.avgHoldingHours < 72
          ? s.winRate
          : -1, // -1 = 条件不成立マーカー
    hit: (v) => v >= 85,
    reasonJa: (v) =>
      `勝率${v.toFixed(0)}%×短期保有（3日未満）は「小さく勝って大きく負ける」偽陽性パターン`,
  },
  {
    gateId: "G5_OVERTRADING",
    threshold: 20,
    value: (s) => s.dailyTrades,
    hit: (v) => v > 20,
    reasonJa: (v) =>
      `1日${v.toFixed(1)}回の取引はコピー追随が物理的に不能（0.3 SOL固定では資金破綻）`,
  },
];

/**
 * @returns {{passed: boolean, failures: GateFailure[], skipped: string[]}}
 */
export function runGates(stats) {
  const failures = [];
  const skipped = [];
  for (const g of GATES) {
    const v = g.value(stats);
    if (v == null) {
      skipped.push(g.gateId);
      continue;
    }
    if (g.hit(v)) {
      failures.push({
        gateId: g.gateId,
        reasonJa: g.reasonJa(v),
        value: v,
        threshold: g.threshold,
      });
    }
  }
  return { passed: failures.length === 0, failures, skipped };
}
