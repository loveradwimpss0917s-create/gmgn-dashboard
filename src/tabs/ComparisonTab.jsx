// 複数トレーダー比較（DESIGN.md §5.4）— 最大4体の列比較

import { useState } from "react";
import { WEIGHTS, COMPONENT_LABELS } from "../engine/score.js";
import { STRATEGY_LABELS } from "../engine/classify.js";
import { loadTraders, removeTrader } from "../store/traders.js";
import { G, Y, R, MUTE, TEXT, cardStyle, DECISION_UI, shortAddr } from "../ui.js";

const MAX_COMPARE = 4;

export default function ComparisonTab() {
  const [traders, setTraders] = useState(() => loadTraders());
  const [selected, setSelected] = useState([]);

  const entries = Object.entries(traders);

  function toggle(addr) {
    setSelected((p) =>
      p.includes(addr) ? p.filter((a) => a !== addr)
      : p.length >= MAX_COMPARE ? p : [...p, addr],
    );
  }

  function remove(addr) {
    setTraders({ ...removeTrader(addr) });
    setSelected((p) => p.filter((a) => a !== addr));
  }

  const cols = selected.map((a) => traders[a]).filter(Boolean);

  const rows = [
    { label: "総合スコア", get: (t) => t.verdict.score.totalScore, fmt: (v) => v ?? "—", best: "max" },
    { label: "判定", get: (t) => t.verdict.decision, fmt: (v) => DECISION_UI[v]?.label ?? v },
    { label: "分類", get: (t) => t.verdict.strategyType, fmt: (v) => STRATEGY_LABELS[v] },
    ...Object.keys(WEIGHTS).map((k) => ({
      label: COMPONENT_LABELS[k],
      get: (t) => t.verdict.score[k],
      fmt: (v) => (v == null ? "—" : Math.round(v)),
      best: "max",
    })),
    { label: "保有（日）", get: (t) => t.stats.avgHoldingHours, fmt: (v) => (v == null ? "—" : (v / 24).toFixed(1)) },
    { label: "勝率（%）", get: (t) => t.stats.winRate, fmt: (v) => v ?? "—" },
    { label: "取引（回/日）", get: (t) => t.stats.dailyTrades, fmt: (v) => (v == null ? "—" : v.toFixed(1)) },
    { label: "未実現（$）", get: (t) => t.stats.unrealizedPnlUsd, fmt: (v) => v ?? "—", best: "max" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={cardStyle()}>
        <div style={{ fontWeight: 800, fontSize: 13, color: G, marginBottom: 8 }}>⚖ トレーダー比較</div>
        {entries.length === 0 ? (
          <div style={{ fontSize: 11, color: MUTE, lineHeight: 1.8 }}>
            保存済みトレーダーがありません。「分析」または「発見」タブで評価して保存してください。
          </div>
        ) : (
          <>
            <div style={{ fontSize: 10, color: MUTE, marginBottom: 8 }}>
              比較対象を選択（最大{MAX_COMPARE}体）
            </div>
            {entries.map(([addr, t]) => {
              const on = selected.includes(addr);
              const dui = DECISION_UI[t.verdict.decision];
              return (
                <div key={addr}
                  onClick={() => toggle(addr)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                    borderRadius: 8, marginBottom: 4, cursor: "pointer",
                    background: on ? G + "12" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${on ? G + "44" : "rgba(255,255,255,0.06)"}` }}>
                  <span style={{ fontSize: 12 }}>{on ? "☑" : "☐"}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: TEXT }}>
                    {t.stats.label || shortAddr(addr)}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 800,
                    color: (t.verdict.score.totalScore ?? 0) >= 65 ? G : Y }}>
                    {t.verdict.score.totalScore ?? "—"}点
                  </span>
                  <span style={{ fontSize: 10, color: dui.color }}>{dui.label}</span>
                  <button onClick={(e) => { e.stopPropagation(); remove(addr); }}
                    style={{ marginLeft: "auto", background: "none", border: "none",
                      color: R + "66", cursor: "pointer", fontSize: 14 }}>×</button>
                </div>
              );
            })}
          </>
        )}
      </div>

      {cols.length >= 2 && (
        <div style={cardStyle({ overflowX: "auto", padding: "10px 8px" })}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 10 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", color: MUTE, padding: "6px 8px" }}></th>
                {cols.map((t) => (
                  <th key={t.stats.address} style={{ color: TEXT, padding: "6px 8px", fontSize: 10 }}>
                    {t.stats.label || shortAddr(t.stats.address)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const vals = cols.map((t) => row.get(t));
                const nums = vals.filter((v) => typeof v === "number");
                const best = row.best === "max" && nums.length > 1 ? Math.max(...nums) : null;
                return (
                  <tr key={row.label} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <td style={{ color: MUTE, padding: "6px 8px", whiteSpace: "nowrap" }}>{row.label}</td>
                    {vals.map((v, i) => (
                      <td key={i} style={{ padding: "6px 8px", textAlign: "center", fontWeight: 700,
                        color: best != null && v === best ? G : TEXT,
                        background: best != null && v === best ? G + "0d" : "transparent" }}>
                        {row.fmt(v)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
