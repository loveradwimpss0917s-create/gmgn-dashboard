// 判定理由の生成（DESIGN.md §3.6）— テンプレート方式・決定的・最低3文

import { WEIGHTS, COMPONENT_LABELS } from "./score.js";
import { STRATEGY_LABELS } from "./classify.js";

const GRADE_JA = { A: "A判定（コピー推奨）", B: "B判定（良）", C: "C判定（要観察）", D: "D判定（不採用）" };

const STRONG_TEXT = {
  holdingScore: (s) =>
    `平均保有${(s.avgHoldingHours / 24).toFixed(1)}日は理想帯（14–45日）に近く、コピー時のスリッページ・遅延の影響を受けにくい構造です`,
  stabilityScore: () => `月次損益がプラスで安定しており、瞬間風速ではなく再現性のある成績です`,
  winRateScore: (s) => `勝率${s.winRate?.toFixed(0)}%は過信リスクの少ない健全なレンジ（55–65%が最良）にあります`,
  riskScore: () => `含み損が小さく、実現益の見せかけ（塩漬け隠し）の兆候がありません`,
  executionScore: (s) => `1日${s.dailyTrades?.toFixed(1)}回の取引頻度はコピー追随に最適（0.5–3回/日）です`,
};

const WEAK_TEXT = {
  holdingScore: (s) =>
    `平均保有${(s.avgHoldingHours / 24).toFixed(1)}日が理想帯（14–45日）から外れており、保有時間の項目が弱点です`,
  stabilityScore: () => `月次損益の安定性が低く（マイナス月または変動大）、成績の再現性に不安があります`,
  winRateScore: (s) => `勝率${s.winRate?.toFixed(0)}%は評価上不利なレンジです（低すぎ、または偽陽性リスクの高すぎ）`,
  riskScore: (s) =>
    `含み損$${Math.abs(s.unrealizedPnlUsd ?? 0).toFixed(0)}が重く、リスク項目が弱点です`,
  executionScore: (s) => `1日${s.dailyTrades?.toFixed(1)}回の取引頻度はコピー追随に不利です`,
};

/**
 * @param verdictBase {decision, strategyType, gate, warnings}
 * @param score Score
 * @param stats TraderStats
 * @param rules {buySOL, slPct, tpPct} 運用ルール
 */
export function buildReasons(verdictBase, score, stats, rules) {
  const reasons = [];
  const typeJa = STRATEGY_LABELS[verdictBase.strategyType];

  // 1. 結論文
  if (verdictBase.decision === "INSUFFICIENT_DATA") {
    reasons.push(
      "データ不足のため判定できません。GMGN画面の値を補完入力するか、取引履歴のあるウォレットを指定してください",
    );
    return reasons;
  }
  if (verdictBase.decision === "NG" && !verdictBase.gate.passed) {
    reasons.push(`除外条件に該当したため即NG。${typeJa}に分類されます`);
  } else {
    reasons.push(
      `総合${score.totalScore}点・${GRADE_JA[score.grade]}。${typeJa}に分類されます`,
    );
  }

  // 4. ゲート落ち理由（該当時）
  for (const f of verdictBase.gate.failures) {
    reasons.push(f.reasonJa);
  }

  // 2–3. 最強要因（寄与 = score × weight の最大）・最弱要因（素点の最小）
  if (verdictBase.gate.passed) {
    const avail = Object.keys(WEIGHTS).filter((k) => score[k] != null);
    if (avail.length >= 2) {
      const bestK = avail.reduce((a, b) =>
        score[a] * WEIGHTS[a] >= score[b] * WEIGHTS[b] ? a : b,
      );
      const worstK = avail.reduce((a, b) => (score[a] <= score[b] ? a : b));
      reasons.push(`◎ 強み（${COMPONENT_LABELS[bestK]}）: ${STRONG_TEXT[bestK](stats)}`);
      if (score[worstK] < 80) {
        reasons.push(`△ 弱み（${COMPONENT_LABELS[worstK]}）: ${WEAK_TEXT[worstK](stats)}`);
      } else {
        reasons.push("全項目がバランス良好で、明確な弱点はありません");
      }
    }
  }

  // 5. 運用ルール適合性
  const buySOL = rules?.buySOL ?? 0.3;
  const slPct = rules?.slPct ?? -60;
  if (stats.avgHoldingHours != null && stats.avgHoldingHours >= 14 * 24) {
    reasons.push(
      `SL${slPct}%・TPなし運用と相性が良い（長期保有前提のため、コピー元の売却に任せる戦略が機能します）`,
    );
  }
  if (stats.dailyTrades != null && stats.dailyTrades > 3) {
    const daily = (buySOL * stats.dailyTrades).toFixed(1);
    reasons.push(
      `1回${buySOL} SOL固定では1日${stats.dailyTrades.toFixed(1)}回のコピーで日次約${daily} SOL必要。資金計画に注意`,
    );
  }

  return reasons;
}
