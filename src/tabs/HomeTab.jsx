// ダッシュボード（DESIGN.md §5.1）— 現在コピー中 / 運用ルール / Risk Panel

import { useState } from "react";
import { evaluate } from "../engine/verdict.js";
import { STRATEGY_LABELS } from "../engine/classify.js";
import { loadRules, saveRules, loadAlerts, dismissAlert, loadTraders } from "../store/traders.js";
import ScoreCard from "../components/ScoreCard.jsx";
import { G, Y, R, MUTE, TEXT, inp, cardStyle, btnStyle, DECISION_UI, shortAddr } from "../ui.js";

// 現在コピー中のGameトレーダー実測値（GMGN画面より）
const CURRENT_TRADER = {
  address: "current-game-trader",
  label: "Game（コピー中）",
  avgHoldingHours: 33 * 24,
  winRate: 56,
  dailyTrades: 0.8,
  tradeCount30d: 24,
  realizedPnlUsd: null,
  unrealizedPnlUsd: 0,
  shortTermRatio: null,
  monthlyPnl: null,
  source: "manual",
};

export default function HomeTab({ goTo }) {
  const [rules, setRules] = useState(() => loadRules());
  const [alerts, setAlerts] = useState(() => loadAlerts());
  const [editing, setEditing] = useState(false);
  const [showCard, setShowCard] = useState(false);

  const traders = loadTraders();
  const savedCount = Object.keys(traders).length;
  const verdict = evaluate(CURRENT_TRADER, rules);
  const dui = DECISION_UI[verdict.decision];

  function updateRule(k, v) {
    const next = { ...rules, [k]: v === "" ? null : parseFloat(v) };
    setRules(next);
    saveRules(next);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* モード切替 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <button onClick={() => goTo("discovery")} style={{ ...cardStyle({ cursor: "pointer", textAlign: "left" }) }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: G }}>🔍 発見</div>
          <div style={{ fontSize: 10, color: MUTE, marginTop: 4, lineHeight: 1.6 }}>
            候補ウォレットを一括分析してランキング
          </div>
        </button>
        <button onClick={() => goTo("validation")} style={{ ...cardStyle({ cursor: "pointer", textAlign: "left" }) }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: Y }}>📋 分析</div>
          <div style={{ fontSize: 10, color: MUTE, marginTop: 4, lineHeight: 1.6 }}>
            ウォレットを貼ってコピー可否を判定
          </div>
        </button>
      </div>

      {/* Risk Panel */}
      <div style={cardStyle(alerts.length > 0
        ? { background: R + "08", border: `1px solid ${R}33` }
        : {})}>
        <div style={{ fontWeight: 700, fontSize: 12, color: alerts.length > 0 ? R : MUTE, marginBottom: alerts.length > 0 ? 8 : 0 }}>
          🟥 Risk Panel — アラート {alerts.length} 件
          <span style={{ fontWeight: 400, fontSize: 10, color: MUTE, marginLeft: 8 }}>
            （保存済み{savedCount}体を再分析時に自動検知）
          </span>
        </div>
        {alerts.map((a) => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0",
            borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <span style={{ fontSize: 11, color: TEXT, lineHeight: 1.6, flex: 1 }}>{a.msg}</span>
            <button onClick={() => setAlerts(dismissAlert(a.id))}
              style={{ background: "none", border: "none", color: MUTE, cursor: "pointer", fontSize: 13 }}>✓</button>
          </div>
        ))}
      </div>

      {/* 現在コピー中 */}
      <div style={cardStyle({ background: G + "06", border: `1px solid ${G}22` })}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: G }}>
              Game（コピー中）
              <span style={{ marginLeft: 8, fontSize: 12, color: dui.color }}>{dui.label}</span>
            </div>
            <div style={{ fontSize: 10, color: MUTE, marginTop: 4 }}>
              保有33日 · 勝率56% · 未実現±$0 · {STRATEGY_LABELS[verdict.strategyType]}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: G }}>
              {verdict.score.totalScore}<span style={{ fontSize: 10 }}>点</span>
            </div>
            <div style={{ fontSize: 10, color: MUTE }}>grade {verdict.score.grade}</div>
          </div>
        </div>
        <button onClick={() => setShowCard(!showCard)}
          style={{ ...inp, width: "auto", marginTop: 8, padding: "4px 12px", fontSize: 10, cursor: "pointer" }}>
          {showCard ? "閉じる" : "エンジン評価の詳細"}
        </button>
        {showCard && <div style={{ marginTop: 10 }}><ScoreCard verdict={verdict} /></div>}
      </div>

      {/* 運用ルール */}
      <div style={cardStyle()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 12, color: Y }}>⚙ 運用ルール</span>
          <button onClick={() => setEditing(!editing)}
            style={{ background: "none", border: "none", color: MUTE, cursor: "pointer", fontSize: 11 }}>
            {editing ? "完了" : "編集"}
          </button>
        </div>
        {editing ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
            {[
              ["buySOL", "1回購入（SOL）"],
              ["slPct", "SL（%）"],
              ["devSellPct", "Dev Sell（%）"],
              ["autoSellPct", "Auto Sell（%）"],
            ].map(([k, label]) => (
              <div key={k}>
                <div style={{ fontSize: 9, color: MUTE, marginBottom: 2 }}>{label}</div>
                <input type="number" value={rules[k] ?? ""}
                  onChange={(e) => updateRule(k, e.target.value)} style={inp} />
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: TEXT, lineHeight: 2 }}>
            1回 {rules.buySOL} SOL ｜ SL {rules.slPct}% ｜ TP {rules.tpPct == null ? "なし" : rules.tpPct + "%"} ｜
            Dev Sell {rules.devSellPct}% / Auto {rules.autoSellPct}%
          </div>
        )}
        <div style={{ fontSize: 9, color: MUTE, marginTop: 6 }}>
          ※ このルールはスコアリングの「理由説明」と資金計画コメントに反映されます
        </div>
      </div>
    </div>
  );
}
