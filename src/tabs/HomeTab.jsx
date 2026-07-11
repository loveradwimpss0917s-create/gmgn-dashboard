// ダッシュボード（DESIGN.md §5.1）— 現在コピー中 / 運用ルール / Risk Panel / ポジションサイジング

import { useState } from "react";
import { evaluate } from "../engine/verdict.js";
import { rpcToStats, mergeStats } from "../engine/merge.js";
import { suggestPositionSize } from "../engine/sizing.js";
import { isSolanaAddress } from "../engine/util.js";
import { STRATEGY_LABELS } from "../engine/classify.js";
import {
  loadRules, saveRules, loadAlerts, dismissAlert, loadTraders,
  loadActiveCopy, saveActiveCopy, saveTrader,
} from "../store/traders.js";
import ScoreCard from "../components/ScoreCard.jsx";
import { G, Y, R, MUTE, TEXT, inp, cardStyle, btnStyle, smallBtn, DECISION_UI, shortAddr, load } from "../ui.js";

// アクティブコピー未登録時の初期表示用サンプル（GMGN画面より・実測値）
const SAMPLE_TRADER = {
  address: "sample-game-trader",
  label: "Game（サンプル）",
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
  const [activeCopy, setActiveCopy] = useState(() => loadActiveCopy());
  const [addrInput, setAddrInput] = useState("");
  const [editingAddr, setEditingAddr] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);

  const traders = loadTraders();
  const savedCount = Object.keys(traders).length;

  const activeEntry = activeCopy.address ? traders[activeCopy.address] : null;
  const isSample = !activeEntry;
  const displayStats = activeEntry?.stats ?? SAMPLE_TRADER;
  const verdict = activeEntry?.verdict ?? evaluate(SAMPLE_TRADER, rules);
  const dui = DECISION_UI[verdict.decision];

  const bankrollSol = load("gmgn_sol", 3.4123);
  const sizing = suggestPositionSize({
    bankrollSol,
    riskPerTradePct: rules.riskPerTradePct,
    slPct: rules.slPct,
    grade: verdict.score.grade,
  });

  function updateRule(k, v) {
    const next = { ...rules, [k]: v === "" ? null : parseFloat(v) };
    setRules(next);
    saveRules(next);
  }

  async function registerAndEvaluate(addr) {
    if (!isSolanaAddress(addr)) {
      setStatus({ ok: false, msg: "❌ Solanaアドレス形式が不正です" });
      return;
    }
    setLoading(true);
    setStatus(null);

    // RPC取得の失敗は独立して扱い、失敗しても手動データのみで登録を完走させる
    // （ValidationTabのfetchRpcと同じフォールバック方針）
    let rpcStats = null;
    let rpcWarn = "";
    try {
      const res = await fetch(`/api/wallet/${addr}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      rpcStats = rpcToStats(addr, json?.data);
    } catch (e) {
      rpcWarn = `（RPC取得失敗: ${e.message}。手動値のみで登録）`;
    }

    try {
      const manual = { address: addr, label: shortAddr(addr), source: "manual" };
      const merged = mergeStats(manual, rpcStats);
      const v = evaluate(merged, rules);
      const { alerts: newAlerts } = saveTrader(merged, v);
      saveActiveCopy({ address: addr });
      setActiveCopy({ address: addr });
      if (newAlerts.length > 0) setAlerts(loadAlerts());
      setStatus({ ok: true, msg: `✅ 登録・評価完了（grade ${v.score.grade ?? "—"}）${rpcWarn}` });
      setEditingAddr(false);
      setAddrInput("");
    } catch (e) {
      setStatus({ ok: false, msg: `❌ 登録失敗: ${e.message}` });
    } finally {
      setLoading(false);
    }
  }

  async function reevaluate() {
    if (!activeCopy.address) return;
    await registerAndEvaluate(activeCopy.address);
  }

  function clearActiveCopy() {
    saveActiveCopy({ address: null });
    setActiveCopy({ address: null });
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
              {displayStats.label || shortAddr(displayStats.address)}
              {isSample && <span style={{ fontSize: 9, color: MUTE, fontWeight: 400, marginLeft: 6 }}>（未登録・サンプル表示）</span>}
              <span style={{ marginLeft: 8, fontSize: 12, color: dui.color }}>{dui.label}</span>
            </div>
            <div style={{ fontSize: 10, color: MUTE, marginTop: 4 }}>
              {displayStats.avgHoldingHours != null ? `保有${(displayStats.avgHoldingHours / 24).toFixed(0)}日` : "保有—"}
              {" · "}{displayStats.winRate != null ? `勝率${displayStats.winRate}%` : "勝率—"}
              {" · "}{displayStats.unrealizedPnlUsd != null ? `未実現$${displayStats.unrealizedPnlUsd}` : "未実現—"}
              {" · "}{STRATEGY_LABELS[verdict.strategyType]}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: G }}>
              {verdict.score.totalScore ?? "—"}<span style={{ fontSize: 10 }}>点</span>
            </div>
            <div style={{ fontSize: 10, color: MUTE }}>grade {verdict.score.grade ?? "—"}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button onClick={() => setShowCard(!showCard)}
            style={{ ...inp, width: "auto", padding: "4px 12px", fontSize: 10, cursor: "pointer" }}>
            {showCard ? "閉じる" : "エンジン評価の詳細"}
          </button>
          {!isSample && (
            <button onClick={reevaluate} disabled={loading}
              style={smallBtn(G, loading)}>
              {loading ? "再評価中…" : "🔄 再評価"}
            </button>
          )}
          <button onClick={() => setEditingAddr(!editingAddr)}
            style={{ ...inp, width: "auto", padding: "4px 12px", fontSize: 10, cursor: "pointer", color: MUTE }}>
            {isSample ? "アドレス登録" : "変更"}
          </button>
          {!isSample && (
            <button onClick={clearActiveCopy}
              style={{ ...inp, width: "auto", padding: "4px 12px", fontSize: 10, cursor: "pointer", color: R + "cc" }}>
              解除
            </button>
          )}
        </div>

        {editingAddr && (
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <input placeholder="コピー中トレーダーのSolanaアドレス"
              value={addrInput} onChange={(e) => setAddrInput(e.target.value)}
              style={{ ...inp, flex: 1, fontSize: 11 }} />
            <button onClick={() => registerAndEvaluate(addrInput.trim())} disabled={loading || !addrInput.trim()}
              style={smallBtn(G, loading || !addrInput.trim())}>
              登録
            </button>
          </div>
        )}
        {status && (
          <div style={{ marginTop: 6, fontSize: 10, color: status.ok ? G : R }}>{status.msg}</div>
        )}
        <div style={{ fontSize: 9, color: MUTE, marginTop: 6 }}>
          {isSample
            ? "実際にコピー中のウォレットアドレスを登録すると、自動でRPC評価しRisk Panelの監視対象になります"
            : "「再評価」で最新データを取得し、前回からのスコア急落・戦略変化・NG化をRisk Panelに通知します"}
        </div>

        {showCard && <div style={{ marginTop: 10 }}><ScoreCard verdict={verdict} /></div>}
      </div>

      {/* ポジションサイジング・アドバイザー */}
      <div style={cardStyle({ background: Y + "06", border: `1px solid ${Y}22` })}>
        <div style={{ fontWeight: 700, fontSize: 12, color: Y, marginBottom: 8 }}>
          💰 ポジションサイジング・アドバイザー
        </div>
        {sizing ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 10, color: MUTE }}>
                残高 {bankrollSol.toFixed(3)} SOL × リスク{rules.riskPerTradePct}% ÷ SL{Math.abs(rules.slPct)}% × grade{verdict.score.grade ?? "?"}係数{sizing.qualityMult}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: sizing.sizeSol > 0 ? Y : R }}>
                {sizing.sizeSol}<span style={{ fontSize: 11 }}> SOL</span>
              </div>
              <div style={{ fontSize: 10, color: MUTE }}>
                現在ルール: {rules.buySOL} SOL
                {rules.buySOL != null && sizing.sizeSol > 0 && (
                  <span style={{ marginLeft: 6, color: sizing.sizeSol > rules.buySOL ? G : R }}>
                    ({sizing.sizeSol > rules.buySOL ? "+" : ""}{(sizing.sizeSol - rules.buySOL).toFixed(3)})
                  </span>
                )}
              </div>
            </div>
            {sizing.warnings.map((w, i) => (
              <div key={i} style={{ fontSize: 10, color: R, marginTop: 4 }}>⚠ {w}</div>
            ))}
            <div style={{ fontSize: 9, color: MUTE, marginTop: 6 }}>
              最大想定損失 ≈ {sizing.riskAmountSol} SOL（残高の{rules.riskPerTradePct}%）。下の運用ルールでリスク%を調整できます
            </div>
          </>
        ) : (
          <div style={{ fontSize: 11, color: MUTE }}>
            残高・SL%・リスク%が揃うと提案額を計算します（残高タブで残高を設定してください）
          </div>
        )}
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
              ["riskPerTradePct", "1トレードのリスク（%）"],
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
            リスク {rules.riskPerTradePct}%/回 ｜ Dev Sell {rules.devSellPct}% / Auto {rules.autoSellPct}%
          </div>
        )}
        <div style={{ fontSize: 9, color: MUTE, marginTop: 6 }}>
          ※ このルールはスコアリングの「理由説明」・ポジションサイジング提案に反映されます
        </div>
      </div>
    </div>
  );
}
