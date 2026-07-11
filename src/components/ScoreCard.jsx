// 分析結果カード（DESIGN.md §5.3）

import { WEIGHTS, COMPONENT_LABELS } from "../engine/score.js";
import { STRATEGY_LABELS } from "../engine/classify.js";
import { G, Y, R, MUTE, TEXT, cardStyle, DECISION_UI } from "../ui.js";

function ScoreBar({ label, value, weight }) {
  const c = value == null ? MUTE : value >= 70 ? G : value >= 45 ? Y : R;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 10, color: MUTE, width: 52 }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 800, color: c, width: 26, textAlign: "right" }}>
        {value == null ? "—" : Math.round(value)}
      </span>
      <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.07)", borderRadius: 3 }}>
        <div style={{ height: "100%", width: `${value ?? 0}%`, background: c, borderRadius: 3, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontSize: 9, color: MUTE, width: 30 }}>w{Math.round(weight * 100)}%</span>
    </div>
  );
}

export default function ScoreCard({ verdict, compact = false, actions = null }) {
  if (!verdict) return null;
  const { score, decision, strategyType, warnings, reasonsJa } = verdict;
  const dui = DECISION_UI[decision];
  const total = score.totalScore;
  const tc = total == null ? MUTE : total >= 80 ? G : total >= 65 ? Y : total >= 50 ? "#ff8a65" : R;

  return (
    <div style={cardStyle({ background: dui.color + "08", border: `1px solid ${dui.color}33` })}>
      {/* ヘッダー行 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <span style={{ fontSize: 26, fontWeight: 900, color: tc }}>
            {total == null ? "—" : total}
          </span>
          <span style={{ fontSize: 11, color: MUTE }}>/100</span>
          {score.grade && (
            <span style={{ marginLeft: 8, fontSize: 14, fontWeight: 800, color: tc }}>
              grade {score.grade}
            </span>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: dui.color }}>{dui.label}</div>
          <div style={{ fontSize: 10, color: MUTE, marginTop: 2 }}>
            {STRATEGY_LABELS[strategyType]}
          </div>
        </div>
      </div>

      {/* 成分バー */}
      {!compact && (
        <div style={{ marginBottom: 10 }}>
          {Object.keys(WEIGHTS).map((k) => (
            <ScoreBar key={k} label={COMPONENT_LABELS[k]} value={score[k]} weight={WEIGHTS[k]} />
          ))}
          <div style={{ fontSize: 10, color: MUTE, marginTop: 4 }}>
            データ充足度 {Math.round((score.dataCompleteness ?? 0) * 100)}%
          </div>
        </div>
      )}

      {/* 警告 */}
      {warnings?.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 10, color: Y, lineHeight: 1.7 }}>⚠ {w}</div>
          ))}
        </div>
      )}

      {/* 判定理由 */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 }}>
        <div style={{ fontSize: 10, color: MUTE, fontWeight: 700, marginBottom: 4 }}>判定理由</div>
        {reasonsJa.map((r, i) => (
          <div key={i} style={{ fontSize: 11, color: TEXT, lineHeight: 1.7, marginBottom: 2 }}>
            ・{r}
          </div>
        ))}
      </div>

      {actions}
    </div>
  );
}
