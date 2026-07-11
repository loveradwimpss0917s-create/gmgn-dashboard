// MODE A: トレーダー検索（DESIGN.md §5.2）— 候補プール方式

import { useState } from "react";
import { evaluate } from "../engine/verdict.js";
import { rpcToStats } from "../engine/merge.js";
import { isSolanaAddress } from "../engine/util.js";
import { STRATEGY_LABELS } from "../engine/classify.js";
import { loadRules, loadPool, savePool, saveTrader } from "../store/traders.js";
import { G, Y, R, MUTE, TEXT, inp, cardStyle, btnStyle, DECISION_UI, shortAddr } from "../ui.js";

const DEFAULT_FILTERS = { wrMin: "", wrMax: "", holdMin: "", holdMax: "", dtMax: "", hideNg: false };

export default function DiscoveryTab({ onSaved }) {
  const [text, setText] = useState(() => loadPool().join("\n"));
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [rows, setRows] = useState([]); // {address, stats, verdict}
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [detail, setDetail] = useState(null);

  async function analyzeAll() {
    const addrs = [...new Set(
      text.split(/[\n,\s]+/).map((s) => s.trim()).filter(isSolanaAddress),
    )];
    if (addrs.length === 0) {
      setProgress("❌ 有効なSolanaアドレスがありません（1行1件で貼り付け）");
      return;
    }
    const capped = addrs.slice(0, 20);
    savePool(capped);
    setLoading(true);
    setProgress(`分析中… 0/${capped.length}`);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses: capped }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rules = loadRules();
      const out = [];
      for (const r of json.results ?? []) {
        const stats = rpcToStats(r.address, r);
        out.push({ address: r.address, stats, verdict: evaluate(stats, rules) });
      }
      for (const e of json.errors ?? []) {
        out.push({ address: e.address, stats: null, verdict: null, error: e.error });
      }
      setRows(out);
      setProgress(
        `✅ ${json.results?.length ?? 0}件分析完了` +
        (json.errors?.length ? `（${json.errors.length}件失敗）` : "") +
        (addrs.length > 20 ? ` ※20件超は切り捨て（${addrs.length - 20}件）` : ""),
      );
    } catch (e) {
      setProgress(`❌ 一括分析失敗: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  function applyFilters(list) {
    const n = (x) => (x === "" ? null : parseFloat(x));
    const { wrMin, wrMax, holdMin, holdMax, dtMax } = filters;
    return list.filter(({ stats, verdict }) => {
      if (!verdict) return false;
      const wr = stats.winRate;
      const hd = stats.avgHoldingHours != null ? stats.avgHoldingHours / 24 : null;
      const dt = stats.dailyTrades;
      if (n(wrMin) != null && (wr == null || wr < n(wrMin))) return false;
      if (n(wrMax) != null && (wr == null || wr > n(wrMax))) return false;
      if (n(holdMin) != null && (hd == null || hd < n(holdMin))) return false;
      if (n(holdMax) != null && (hd == null || hd > n(holdMax))) return false;
      if (n(dtMax) != null && (dt == null || dt > n(dtMax))) return false;
      return true;
    });
  }

  const analyzed = rows.filter((r) => r.verdict);
  const failed = rows.filter((r) => !r.verdict);
  const passed = applyFilters(analyzed.filter((r) => r.verdict.decision !== "NG"))
    .sort((a, b) => (b.verdict.score.totalScore ?? -1) - (a.verdict.score.totalScore ?? -1))
    .slice(0, 20);
  const ngList = analyzed.filter((r) => r.verdict.decision === "NG");

  function saveCandidate(row) {
    saveTrader(row.stats, row.verdict);
    onSaved?.();
  }

  const filterInp = (k, ph, w = 44) => (
    <input type="number" placeholder={ph} value={filters[k]}
      onChange={(e) => setFilters((p) => ({ ...p, [k]: e.target.value }))}
      style={{ ...inp, width: w, padding: "5px 6px", fontSize: 10 }} />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* プール登録 */}
      <div style={cardStyle({ background: "rgba(0,229,160,0.04)", border: "1px solid rgba(0,229,160,0.15)" })}>
        <div style={{ fontWeight: 800, fontSize: 13, color: G, marginBottom: 8 }}>
          🔍 トレーダー発見（Discovery）
        </div>
        <div style={{ fontSize: 10, color: MUTE, lineHeight: 1.7, marginBottom: 8 }}>
          GMGNのランキング/コピー画面から候補ウォレットを貼り付け（1行1件・最大20件）。
          RPCから統計を推計し、スコア順にランキングします。
        </div>
        <textarea
          rows={5}
          placeholder={"7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU\n..."}
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ ...inp, fontFamily: "monospace", fontSize: 10, resize: "vertical" }}
        />
        <button onClick={analyzeAll} disabled={loading} style={btnStyle(G)}>
          {loading ? "分析中…（1件ずつ順次実行）" : "一括分析（最大20件）"}
        </button>
        {progress && <div style={{ marginTop: 8, fontSize: 11, color: progress.startsWith("❌") ? R : G }}>{progress}</div>}
      </div>

      {/* フィルター */}
      {analyzed.length > 0 && (
        <div style={cardStyle()}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 10, color: MUTE }}>
            <span>勝率</span>{filterInp("wrMin", "40")}–{filterInp("wrMax", "80")}%
            <span style={{ marginLeft: 6 }}>保有</span>{filterInp("holdMin", "7")}–{filterInp("holdMax", "60")}日
            <span style={{ marginLeft: 6 }}>回数/日≤</span>{filterInp("dtMax", "3")}
          </div>
        </div>
      )}

      {/* ランキング */}
      {passed.length > 0 && (
        <div style={cardStyle()}>
          <div style={{ fontWeight: 700, fontSize: 12, color: G, marginBottom: 10 }}>🏆 候補ランキング</div>
          {passed.map((row, i) => {
            const v = row.verdict;
            const dui = DECISION_UI[v.decision];
            return (
              <div key={row.address} style={{ padding: "8px 10px", borderRadius: 8, marginBottom: 6,
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: MUTE, fontWeight: 800, width: 24 }}>#{i + 1}</span>
                  <span style={{ fontSize: 11, fontFamily: "monospace", color: TEXT }}>{shortAddr(row.address)}</span>
                  <span style={{ fontSize: 13, fontWeight: 900,
                    color: v.score.totalScore >= 80 ? G : v.score.totalScore >= 65 ? Y : "#ff8a65" }}>
                    {v.score.totalScore}<span style={{ fontSize: 9 }}>({v.score.grade})</span>
                  </span>
                  <span style={{ fontSize: 10, color: MUTE }}>{STRATEGY_LABELS[v.strategyType]}</span>
                  <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, color: dui.color }}>{dui.label}</span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button onClick={() => setDetail(detail === row.address ? null : row.address)}
                    style={{ ...inp, width: "auto", padding: "4px 10px", fontSize: 10, cursor: "pointer" }}>
                    {detail === row.address ? "閉じる" : "詳細"}
                  </button>
                  <button onClick={() => saveCandidate(row)}
                    style={{ ...inp, width: "auto", padding: "4px 10px", fontSize: 10, cursor: "pointer", color: G }}>
                    保存（比較+）
                  </button>
                </div>
                {detail === row.address && (
                  <div style={{ marginTop: 8, fontSize: 10, color: TEXT, lineHeight: 1.8 }}>
                    {v.reasonsJa.map((r, j) => <div key={j}>・{r}</div>)}
                    {v.warnings.map((w, j) => <div key={j} style={{ color: Y }}>⚠ {w}</div>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* NGリスト */}
      {ngList.length > 0 && (
        <div style={cardStyle({ background: R + "06", border: `1px solid ${R}22` })}>
          <div style={{ fontWeight: 700, fontSize: 12, color: R, marginBottom: 10 }}>🚫 NGリスト（除外理由つき）</div>
          {ngList.map((row) => (
            <div key={row.address} style={{ padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span style={{ fontSize: 11, fontFamily: "monospace", color: TEXT }}>{shortAddr(row.address)}</span>
              <span style={{ fontSize: 10, color: MUTE, marginLeft: 8 }}>
                {STRATEGY_LABELS[row.verdict.strategyType]}
              </span>
              <div style={{ fontSize: 10, color: R + "cc", lineHeight: 1.6, marginTop: 2 }}>
                {(row.verdict.gate.failures.length > 0
                  ? row.verdict.gate.failures.map((f) => f.reasonJa)
                  : row.verdict.reasonsJa.slice(0, 1)
                ).map((r, j) => <div key={j}>— {r}</div>)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 取得失敗 */}
      {failed.length > 0 && (
        <div style={cardStyle()}>
          <div style={{ fontWeight: 700, fontSize: 11, color: MUTE, marginBottom: 6 }}>取得失敗</div>
          {failed.map((row) => (
            <div key={row.address} style={{ fontSize: 10, color: MUTE }}>
              {shortAddr(row.address)} — {row.error}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
