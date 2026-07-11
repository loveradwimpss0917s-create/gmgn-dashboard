// MODE B: ウォレット分析（DESIGN.md §5.3）

import { useState } from "react";
import { evaluate } from "../engine/verdict.js";
import { mergeStats, rpcToStats } from "../engine/merge.js";
import { isSolanaAddress } from "../engine/util.js";
import { loadRules, saveTrader } from "../store/traders.js";
import ScoreCard from "../components/ScoreCard.jsx";
import { G, Y, R, MUTE, inp, cardStyle, btnStyle, smallBtn, load, save, shortAddr } from "../ui.js";

const PAST_TRADERS = [
  { name: "追跡 勝率9割", verdict: "❌", reason: "保有6秒スキャルピング" },
  { name: "D8n8…anS4", verdict: "❌", reason: "短期混在・遅延負け" },
  { name: "6Myw…RU1G", verdict: "△", reason: "未実現-$9.7K・短期混在" },
  { name: "Doji", verdict: "❌", reason: "平均保有13分" },
  { name: "Game", verdict: "✅", reason: "平均保有33日・未実現+$0・安定", active: true },
  { name: "次候補2", verdict: "❌", reason: "11分保有混在・遅延12%ズレ" },
  { name: "Ax.", verdict: "△", reason: "3月大幅マイナス・様子見" },
  { name: "Gghj…c6FN", verdict: "❌", reason: "実態1〜10分スキャルピング" },
];

const MANUAL_FIELDS = [
  ["holdDays", "保有（日）★最重要w35%"],
  ["winRate", "勝率（%）"],
  ["dailyTrades", "取引（回/日）"],
  ["unrealized", "未実現（$）"],
  ["realized", "実現PnL（$）"],
];

export default function ValidationTab({ onSaved }) {
  const [wallet, setWallet] = useState("");
  const [name, setName] = useState("");
  const [m, setM] = useState({ holdDays: "", winRate: "", dailyTrades: "", unrealized: "", realized: "" });
  const [monthly, setMonthly] = useState("");
  const [rpcStats, setRpcStats] = useState(null);
  const [verdict, setVerdict] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [savedMsg, setSavedMsg] = useState(false);
  const [legacy, setLegacy] = useState(() => load("gmgn_evals", []));

  function manualStats(addr) {
    const num = (x) => (x === "" || x == null ? null : parseFloat(x));
    const mp = monthly
      .split(/[,、\s]+/)
      .map((x) => parseFloat(x))
      .filter((x) => Number.isFinite(x));
    return {
      address: addr,
      label: name || null,
      avgHoldingHours: num(m.holdDays) != null ? num(m.holdDays) * 24 : null,
      winRate: num(m.winRate),
      dailyTrades: num(m.dailyTrades),
      tradeCount30d: num(m.dailyTrades) != null ? Math.round(num(m.dailyTrades) * 30) : null,
      realizedPnlUsd: num(m.realized),
      unrealizedPnlUsd: num(m.unrealized),
      shortTermRatio: null,
      monthlyPnl: mp.length >= 2 ? mp : null,
      source: "manual",
    };
  }

  async function fetchRpc() {
    const addr = wallet.trim();
    if (!isSolanaAddress(addr)) {
      setStatus({ ok: false, msg: "❌ Solanaアドレス形式が不正です" });
      return null;
    }
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/wallet/${addr}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rs = rpcToStats(addr, json?.data);
      setRpcStats(rs);
      const filled = ["avgHoldingHours", "winRate", "dailyTrades", "unrealizedPnlUsd"]
        .filter((k) => rs?.[k] != null).length;
      const warn = json?._warnings?.length ? `（一部データ取得失敗: ${json._warnings.length}件）` : "";
      setStatus({ ok: true, msg: `✅ RPC取得成功（${filled}/4項目・推計値）${warn}` });
      return rs;
    } catch (e) {
      setStatus({ ok: false, msg: `❌ RPC取得失敗: ${e.message}（手動値のみで分析可能）` });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function analyze() {
    const addr = wallet.trim();
    let rs = rpcStats;
    if (addr && isSolanaAddress(addr) && !rs) rs = await fetchRpc();
    const merged = mergeStats(manualStats(addr || "manual-entry"), rs);
    const v = evaluate(merged, loadRules());
    setStats(merged);
    setVerdict(v);
    setSavedMsg(false);
    if (!name && addr) setName(shortAddr(addr));
  }

  function saveResult() {
    if (!verdict || !stats) return;
    saveTrader({ ...stats, label: name || stats.label }, verdict);
    // 旧評価履歴にも併記（後方互換）
    const entry = {
      name: name || shortAddr(stats.address),
      score: verdict.score.totalScore ?? 0,
      verdict:
        verdict.decision === "COPY_OK" ? "✅ 採用候補"
        : verdict.decision === "CONDITIONAL" ? "△ 要観察" : "❌ 不採用",
      date: new Date().toLocaleDateString("ja-JP"),
      id: Date.now(),
    };
    const next = [entry, ...legacy];
    setLegacy(next);
    save("gmgn_evals", next);
    setSavedMsg(true);
    onSaved?.();
  }

  function removeLegacy(id) {
    const next = legacy.filter((x) => x.id !== id);
    setLegacy(next);
    save("gmgn_evals", next);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 入力 */}
      <div style={cardStyle({ background: "rgba(0,229,160,0.04)", border: "1px solid rgba(0,229,160,0.15)" })}>
        <div style={{ fontWeight: 800, fontSize: 13, color: G, marginBottom: 10 }}>
          📋 ウォレット分析（Validation）
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            placeholder="Solanaウォレットアドレスをペースト"
            value={wallet}
            onChange={(e) => { setWallet(e.target.value); setRpcStats(null); setStatus(null); }}
            onKeyDown={(e) => e.key === "Enter" && analyze()}
            style={{ ...inp, flex: 1, fontSize: 11 }}
          />
          <button onClick={fetchRpc} disabled={loading || !wallet.trim()} style={smallBtn(G, loading || !wallet.trim())}>
            {loading ? "取得中…" : "RPC取得"}
          </button>
        </div>
        {status && (
          <div style={{ marginBottom: 8, fontSize: 11, color: status.ok ? G : R }}>{status.msg}</div>
        )}
        <input placeholder="トレーダー名（任意）" value={name}
          onChange={(e) => setName(e.target.value)} style={{ ...inp, marginBottom: 8 }} />
        <div style={{ fontSize: 10, color: MUTE, marginBottom: 6 }}>
          補完入力（GMGN画面から転記・任意。RPC推計値より優先されます）
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7, marginBottom: 7 }}>
          {MANUAL_FIELDS.map(([k, label]) => (
            <div key={k}>
              <div style={{ fontSize: 9, color: MUTE, marginBottom: 2 }}>{label}</div>
              <input type="number" value={m[k]}
                onChange={(e) => setM((p) => ({ ...p, [k]: e.target.value }))} style={inp} />
            </div>
          ))}
          <div>
            <div style={{ fontSize: 9, color: MUTE, marginBottom: 2 }}>月次PnL（カンマ区切り）</div>
            <input placeholder="例: 1200,-300,800（未入力可）" value={monthly}
              onChange={(e) => setMonthly(e.target.value)} style={inp} />
          </div>
        </div>
        <button onClick={analyze} style={btnStyle(G)}>🔍 分析</button>
      </div>

      {/* 結果 */}
      {verdict && (
        <ScoreCard
          verdict={verdict}
          actions={
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={saveResult} style={btnStyle(G)}>
                {savedMsg ? "✅ 保存済み" : "評価を保存（比較・監視対象に追加）"}
              </button>
            </div>
          }
        />
      )}

      {/* 旧評価履歴 */}
      {legacy.length > 0 && (
        <div style={cardStyle()}>
          <div style={{ fontWeight: 700, fontSize: 12, color: MUTE, marginBottom: 10 }}>📋 評価履歴</div>
          {legacy.map((s) => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", padding: "7px 0",
              borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div>
                <span style={{ fontWeight: 700, color: "#e8f0ff", fontSize: 12 }}>{s.name}</span>
                <span style={{ fontSize: 10, color: MUTE, marginLeft: 8 }}>{s.date}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 800,
                  color: s.score >= 70 ? G : s.score >= 45 ? Y : R }}>{s.score}点</span>
                <span style={{ fontSize: 12 }}>{s.verdict.slice(0, 1)}</span>
                <button onClick={() => removeLegacy(s.id)}
                  style={{ background: "none", border: "none", color: R + "66", cursor: "pointer", fontSize: 14 }}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 過去の評価（固定メモ） */}
      <div style={cardStyle()}>
        <div style={{ fontWeight: 700, fontSize: 12, color: MUTE, marginBottom: 10 }}>📜 過去の評価</div>
        {PAST_TRADERS.map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center",
            padding: "6px 8px", borderRadius: 7, marginBottom: 4,
            background: t.active ? G + "0a" : "transparent",
            border: t.active ? `1px solid ${G}22` : "1px solid transparent" }}>
            <span style={{ fontSize: 13 }}>{t.verdict}</span>
            <span style={{ fontWeight: t.active ? 800 : 600,
              color: t.active ? G : "#c8d8f0", fontSize: 12, minWidth: 80 }}>{t.name}</span>
            <span style={{ fontSize: 11, color: MUTE }}>{t.reason}</span>
            {t.active && <span style={{ marginLeft: "auto", fontSize: 10, color: G, fontWeight: 700 }}>コピー中</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
