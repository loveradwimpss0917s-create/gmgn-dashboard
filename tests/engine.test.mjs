import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../src/engine/verdict.js";
import { mergeStats, rpcToStats } from "../src/engine/merge.js";
import { holdingScore, winRateScore, riskScore } from "../src/engine/score.js";
import { suggestPositionSize } from "../src/engine/sizing.js";

const RULES = { buySOL: 0.3, slPct: -60, tpPct: null };

const base = {
  address: "GameTrader1111111111111111111111111111111",
  label: "Game",
  avgHoldingHours: null,
  winRate: null,
  dailyTrades: null,
  tradeCount30d: null,
  realizedPnlUsd: null,
  unrealizedPnlUsd: null,
  shortTermRatio: null,
  monthlyPnl: null,
  source: "manual",
  fetchedAt: "2026-07-11T00:00:00Z",
};

// 受け入れ基準1: 現行コピー中トレーダー（Game）の再現
test("Game trader (33d hold, 56% WR) → B / SWING_STABLE / COPY_OK|CONDITIONAL", () => {
  const v = evaluate(
    {
      ...base,
      avgHoldingHours: 792, // 33日
      winRate: 56,
      dailyTrades: 0.8,
      tradeCount30d: 24,
      unrealizedPnlUsd: 0,
      realizedPnlUsd: 5000,
      monthlyPnl: [1200, 800, -300],
    },
    RULES,
  );
  assert.equal(v.strategyType, "SWING_STABLE");
  assert.ok(["A", "B"].includes(v.score.grade), `grade was ${v.score.grade}`);
  assert.ok(
    ["COPY_OK", "CONDITIONAL"].includes(v.decision),
    `decision was ${v.decision}`,
  );
  assert.ok(v.reasonsJa.length >= 3, "must produce at least 3 reasons");
});

// 受け入れ基準2: スキャルパー×偽陽性勝率 → G1+G4 落ち
test("4h hold + 91% WR → NG with G1 and G4 gate failures", () => {
  const v = evaluate(
    { ...base, avgHoldingHours: 4, winRate: 91, dailyTrades: 8, tradeCount30d: 240 },
    RULES,
  );
  assert.equal(v.decision, "NG");
  assert.equal(v.score.totalScore, 0);
  assert.equal(v.score.grade, "D");
  const ids = v.gate.failures.map((f) => f.gateId);
  assert.ok(ids.includes("G1_SCALP_HOLD"), `gates hit: ${ids}`);
  assert.ok(ids.includes("G4_FAKE_WINRATE"), `gates hit: ${ids}`);
  assert.equal(v.strategyType, "SCALPING");
});

// 受け入れ基準3: 全指標 null → INSUFFICIENT_DATA
test("all-null stats → INSUFFICIENT_DATA (not score 0)", () => {
  const v = evaluate({ ...base }, RULES);
  assert.equal(v.decision, "INSUFFICIENT_DATA");
  assert.equal(v.score.totalScore, null);
});

// 回帰: monthlyPnl（RPC単独では常にnull）が主要指標カウントに含まれることで
// 過度に厳しく判定不能になっていたバグの再現ケース。winRate/dailyTradesのみ
// 取得できた場合、holdingScore(35%)+riskScore(15%)+stabilityScore(25%)が失われ
// 実際に available weight は 0.25 < 0.5 のため、正しく INSUFFICIENT_DATA になる
// べきだが、dataCompleteness は 0 ではなく実測（0.25）を反映すべき
test("partial RPC data (winRate+dailyTrades only) reports real completeness, not a hard 0", () => {
  const v = evaluate(
    { ...base, winRate: 56, dailyTrades: 0.8, tradeCount30d: 24 },
    RULES,
  );
  assert.equal(v.decision, "INSUFFICIENT_DATA");
  assert.ok(
    v.score.dataCompleteness > 0,
    `dataCompleteness should reflect the 2 available metrics, was ${v.score.dataCompleteness}`,
  );
});

// 回帰: holdingScore が欠損でも他の3成分が揃っていれば(completeness>=0.5)
// スコアリングが完走すること（monthlyPnlの構造的欠損だけで巻き添えにしない）
test("3-of-4 RPC fields (missing only unrealizedPnlUsd) still produces a real score", () => {
  const v = evaluate(
    {
      ...base,
      avgHoldingHours: 20 * 24,
      winRate: 56,
      dailyTrades: 0.8,
      tradeCount30d: 24,
    },
    RULES,
  );
  assert.notEqual(v.decision, "INSUFFICIENT_DATA");
  assert.ok(v.score.totalScore > 0, `expected a real score, got ${v.score.totalScore}`);
});

// 受け入れ基準4: RPC全滅でも手動入力のみで完走する
test("manual-only stats complete the pipeline", () => {
  const manual = {
    ...base,
    avgHoldingHours: 20 * 24,
    winRate: 60,
    dailyTrades: 1.2,
    unrealizedPnlUsd: -50,
  };
  const merged = mergeStats(manual, null);
  assert.equal(merged.source, "manual");
  const v = evaluate(merged, RULES);
  assert.notEqual(v.decision, "INSUFFICIENT_DATA");
  assert.ok(v.score.totalScore > 0);
});

// マージ: manual がフィールド単位で rpc に勝つ
test("mergeStats prefers manual per-field", () => {
  const rpc = rpcToStats("addr", {
    winrate: 40,
    avg_hold_duration: 100,
    buy_30d: 15,
    sell_30d: 15,
    unrealized_profit: "500",
  });
  const merged = mergeStats({ ...base, winRate: 62 }, rpc);
  assert.equal(merged.winRate, 62); // manual勝ち
  assert.equal(merged.avgHoldingHours, 100); // rpc補完
  assert.equal(merged.unrealizedPnlUsd, 500);
  assert.equal(merged.source, "merged");
});

// スコア形状の要点
test("holdingScore ideal band and taper", () => {
  assert.equal(holdingScore(14 * 24), 100);
  assert.equal(holdingScore(33 * 24), 100); // 現行Gameの33日は満点帯
  assert.equal(holdingScore(45 * 24), 100);
  assert.ok(holdingScore(90 * 24) < 70);
  assert.ok(holdingScore(24) <= 10);
});

test("winRateScore distrusts extreme winrates", () => {
  assert.ok(winRateScore(60, 30 * 24) > winRateScore(90, 30 * 24));
  assert.equal(winRateScore(70, 200), 100); // 長期×高勝率は本物
  assert.equal(winRateScore(70, 100), 70); // 短中期の高勝率は割引
});

test("riskScore bands", () => {
  assert.equal(riskScore(100, 1000), 100);
  assert.equal(riskScore(-90, 1000), 85);
  assert.equal(riskScore(-600, 1000), 0);
  assert.equal(riskScore(null, 1000), null);
});

// ポジションサイジング
test("suggestPositionSize scales with bankroll and SL, roughly matches the user's existing 0.3 SOL rule", () => {
  const r = suggestPositionSize({ bankrollSol: 3.4123, riskPerTradePct: 5, slPct: -60, grade: "A" });
  assert.ok(r.sizeSol > 0.2 && r.sizeSol < 0.35, `expected ~0.28 SOL, got ${r.sizeSol}`);
});

test("suggestPositionSize scales down for lower-grade traders", () => {
  const a = suggestPositionSize({ bankrollSol: 5, riskPerTradePct: 5, slPct: -60, grade: "A" });
  const c = suggestPositionSize({ bankrollSol: 5, riskPerTradePct: 5, slPct: -60, grade: "C" });
  assert.ok(c.sizeSol < a.sizeSol);
});

test("suggestPositionSize returns 0 for grade D and warns to avoid copying", () => {
  const r = suggestPositionSize({ bankrollSol: 5, riskPerTradePct: 5, slPct: -60, grade: "D" });
  assert.equal(r.sizeSol, 0);
  assert.ok(r.warnings.length > 0);
});

test("suggestPositionSize warns when bankroll is below the critical threshold", () => {
  const r = suggestPositionSize({ bankrollSol: 0.5, riskPerTradePct: 5, slPct: -60, grade: "A" });
  assert.ok(r.warnings.some((w) => w.includes("危険水準")));
});

test("suggestPositionSize returns 0 (not full size) when grade is unknown", () => {
  const r = suggestPositionSize({ bankrollSol: 5, riskPerTradePct: 5, slPct: -60, grade: null });
  assert.equal(r.sizeSol, 0);
  assert.ok(r.warnings.some((w) => w.includes("未評価")));
});

test("suggestPositionSize returns null when required inputs are missing", () => {
  assert.equal(suggestPositionSize({ bankrollSol: null, riskPerTradePct: 5, slPct: -60, grade: "A" }), null);
  assert.equal(suggestPositionSize({ bankrollSol: 3, riskPerTradePct: 5, slPct: null, grade: "A" }), null);
});
