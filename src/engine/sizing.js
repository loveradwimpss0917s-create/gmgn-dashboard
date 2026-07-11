// ポジションサイジング・アドバイザー — 収益最適化のための1回購入額提案
// 純粋関数（React非依存・単体テスト対象）

// トレーダーのグレードに応じてリスク配分を絞る（低グレードほど賭け金を減らす）
export const GRADE_MULTIPLIER = { A: 1, B: 0.8, C: 0.5, D: 0 };

// 手数料負けを避けるための実用上の下限（LESSONS: 「購入額が小さいと手数料負け」）
const MIN_USEFUL_SOL = 0.1;
// 残高がこれを下回ったらコピー自体を止めるべき（BalanceTabのcrit判定と同じ閾値）
const MIN_BANKROLL_SOL = 1;

/**
 * @param {object} p
 * @param {number|null} p.bankrollSol 現在のSOL残高
 * @param {number} p.riskPerTradePct 1トレードで許容する残高比率（%）。例: 5
 * @param {number|null} p.slPct 損切り率（負の%）。例: -60
 * @param {string|null} p.grade トレーダーの評価グレード A/B/C/D（null可）
 * @returns {{sizeSol: number, riskAmountSol: number, qualityMult: number, warnings: string[]} | null}
 *   計算不能な場合は null
 */
export function suggestPositionSize({ bankrollSol, riskPerTradePct, slPct, grade }) {
  if (bankrollSol == null || bankrollSol <= 0) return null;
  if (slPct == null || slPct >= 0) return null;
  if (riskPerTradePct == null || riskPerTradePct <= 0) return null;

  const warnings = [];

  if (bankrollSol < MIN_BANKROLL_SOL) {
    warnings.push(`残高${bankrollSol.toFixed(2)} SOLは危険水準。コピー停止を推奨`);
  }

  // グレード未確定（データ不足で評価できていない）場合は、品質不明のまま
  // フルサイズを提案しない方が安全 — 0を返し、まず分析を完了させるよう促す
  if (grade == null) {
    return {
      sizeSol: 0, riskAmountSol: 0, qualityMult: 0,
      warnings: ["トレーダーが未評価（データ不足）。分析を完了させてから提案します", ...warnings],
    };
  }

  const qualityMult = GRADE_MULTIPLIER[grade] ?? 0;
  if (qualityMult === 0) {
    return { sizeSol: 0, riskAmountSol: 0, qualityMult, warnings: ["gradeDのトレーダーはコピー非推奨（サイズ0）", ...warnings] };
  }

  const riskAmountSol = bankrollSol * (riskPerTradePct / 100);
  const rawSizeSol = riskAmountSol / (Math.abs(slPct) / 100);
  const sizeSol = rawSizeSol * qualityMult;

  if (sizeSol < MIN_USEFUL_SOL) {
    warnings.push(`推奨額が${MIN_USEFUL_SOL} SOL未満。手数料負けリスクのため${MIN_USEFUL_SOL} SOL以上を推奨`);
  }

  return {
    sizeSol: parseFloat(sizeSol.toFixed(3)),
    riskAmountSol: parseFloat(riskAmountSol.toFixed(3)),
    qualityMult,
    warnings,
  };
}
