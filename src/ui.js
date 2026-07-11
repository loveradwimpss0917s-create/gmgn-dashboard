// 共有スタイル・カラー（App.jsx と新タブで共用）

export const G = "#00e5a0";
export const Y = "#f5c542";
export const R = "#ff5252";
export const MUTE = "#8a9bb5";
export const TEXT = "#e8f0ff";

export const inp = {
  width: "100%", boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8, padding: "9px 11px",
  color: TEXT, fontSize: 12, outline: "none",
};

export const cardStyle = (extra = {}) => ({
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12, padding: "14px 16px", ...extra,
});

export const btnStyle = (c) => ({
  width: "100%", marginTop: 8, padding: 10,
  background: c + "22", border: `1px solid ${c}44`,
  borderRadius: 8, color: c, fontSize: 12,
  fontWeight: 700, cursor: "pointer",
});

export const smallBtn = (c, disabled = false) => ({
  padding: "9px 14px", borderRadius: 8, border: `1px solid ${c}44`,
  background: disabled ? "rgba(255,255,255,0.04)" : c + "22",
  color: disabled ? MUTE : c,
  fontSize: 12, fontWeight: 700, cursor: disabled ? "default" : "pointer",
  whiteSpace: "nowrap",
});

export const DECISION_UI = {
  COPY_OK:           { label: "✅ コピー可",   color: G },
  CONDITIONAL:       { label: "⚠ 条件付き",   color: Y },
  NG:                { label: "🚫 コピー不可", color: R },
  INSUFFICIENT_DATA: { label: "❔ 判定不能",   color: MUTE },
};

export const shortAddr = (a) => (a && a.length > 12 ? a.slice(0, 6) + "…" + a.slice(-4) : a);

// localStorage ユーティリティ
export function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
export function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
