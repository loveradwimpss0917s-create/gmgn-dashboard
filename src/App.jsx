import { useState } from "react";

// ── 定数 ──────────────────────────────────────────────
const CRITERIA = [
  { id: "hold",       label: "30d平均保有時間", unit: "日", min: 3,    ideal: 5,  weight: 3 },
  { id: "trades",     label: "1日取引数",       unit: "回", max: 30,   ideal: 10, weight: 2, inverse: true },
  { id: "winrate",    label: "勝率",            unit: "%",  min: 55,   ideal: 65, weight: 3 },
  { id: "unrealized", label: "未実現損益",       unit: "$",  min: -500, ideal: 0,  weight: 2 },
];

const SETTINGS = [
  { label: "購入金額",          value: "0.3 SOL（最大購入金額モード）" },
  { label: "Increase Times",   value: "なし" },
  { label: "Skip Holdings",    value: "OFF" },
  { label: "自動売却",          value: "ON" },
  { label: "TP",               value: "なし（コピー元の売却に任せる）" },
  { label: "SL",               value: "-60% / 100%" },
  { label: "Dev Sell",         value: "25% / Auto Sell 100%" },
  { label: "スリッページ",      value: "自動" },
  { label: "優先手数料",        value: "0.001 SOL" },
  { label: "贈賄料",            value: "0.002 SOL" },
  { label: "ブーストモード（買）", value: "Red." },
  { label: "ブーストモード（売）", value: "Sec." },
];

const PAST_TRADERS = [
  { name: "追跡 勝率9割",  verdict: "❌", reason: "保有6秒スキャルピング" },
  { name: "D8n8…anS4",   verdict: "❌", reason: "短期混在・遅延負け" },
  { name: "6Myw…RU1G",   verdict: "△",  reason: "未実現-$9.7K・短期混在" },
  { name: "Doji",         verdict: "❌", reason: "平均保有13分" },
  { name: "Game",         verdict: "✅", reason: "平均保有33日・未実現+$0・安定", active: true },
  { name: "次候補2",      verdict: "❌", reason: "11分保有混在・遅延12%ズレ" },
  { name: "Ax.",          verdict: "△",  reason: "3月大幅マイナス・様子見" },
  { name: "Gghj…c6FN",  verdict: "❌", reason: "実態1〜10分スキャルピング" },
];

const LESSONS = [
  "平均保有時間が長いほど遅延の影響が小さい",
  "未実現損益がマイナス大＝塩漬けスタイルは危険",
  "勝率80%以上は逆に怪しい（短期スキャルが多い）",
  "活動タブで個別取引の保有時間を必ず確認",
  "購入額が小さいと手数料負け（最低0.3 SOL推奨）",
  "ATM出金は必ず「Accept without conversion」",
];

// ── カラー ────────────────────────────────────────────
const G = "#00e5a0";
const Y = "#f5c542";
const R = "#ff5252";

// ── 共通スタイル ──────────────────────────────────────
const inp = {
  width: "100%", boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8, padding: "9px 11px",
  color: "#e8f0ff", fontSize: 12, outline: "none",
};
const cardStyle = (extra = {}) => ({
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12, padding: "14px 16px", ...extra,
});
const btnStyle = (c) => ({
  width: "100%", marginTop: 8, padding: 10,
  background: c + "22", border: `1px solid ${c}44`,
  borderRadius: 8, color: c, fontSize: 12,
  fontWeight: 700, cursor: "pointer",
});

// ── スコア計算 ────────────────────────────────────────
function calcScore(v) {
  let total = 0, max = 0;
  CRITERIA.forEach(c => {
    max += c.weight * 10;
    const n = parseFloat(v[c.id] || "");
    if (isNaN(n)) return;
    let s = 0;
    if (c.id === "trades")     s = n <= c.ideal ? 10 : n <= c.max ? 6 : 2;
    else if (c.id === "unrealized") s = n >= 0 ? 10 : n >= c.min ? 6 : 2;
    else                       s = n >= c.ideal ? 10 : n >= c.min ? 6 : 2;
    total += s * c.weight;
  });
  return Math.round((total / max) * 100);
}

// ── localStorage ユーティリティ ───────────────────────
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ══════════════════════════════════════════════════════
//  タブ1: トレーダー評価
// ══════════════════════════════════════════════════════
function EvalTab() {
  const [v, setV]         = useState({ hold: "", trades: "", winrate: "", unrealized: "" });
  const [name, setName]   = useState("");
  const [wallet, setWallet] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchStatus, setFetchStatus] = useState(null);
  const [saved, setSaved] = useState(() => load("gmgn_evals", []));

  const score   = calcScore(v);
  const sc      = score >= 70 ? G : score >= 45 ? Y : R;
  const verdict = score >= 70 ? "✅ 採用候補" : score >= 45 ? "△ 要観察" : "❌ 不採用";

  async function fetchWallet() {
    const addr = wallet.trim();
    if (!addr) return;
    setLoading(true);
    setFetchStatus(null);
    try {
      const res = await fetch(`/api/wallet/${addr}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const d = json?.data || json;

      const holdDays = d.avg_hold_duration != null
        ? (d.avg_hold_duration / 86400).toFixed(1) : "";
      const dailyTrades = (d.buy_30d != null || d.sell_30d != null)
        ? (((d.buy_30d || 0) + (d.sell_30d || 0)) / 30).toFixed(1) : "";
      const winrate = d.winrate != null
        ? (d.winrate <= 1 ? (d.winrate * 100).toFixed(1) : d.winrate.toFixed(1)) : "";
      const unrealized = d.unrealized_profit != null
        ? parseFloat(d.unrealized_profit).toFixed(0) : "";

      setV({ hold: holdDays, trades: dailyTrades, winrate, unrealized });
      if (!name) setName(addr.slice(0, 6) + "…" + addr.slice(-4));
      setFetchStatus({ ok: true, msg: "✅ データ取得成功" });
    } catch (e) {
      setFetchStatus({ ok: false, msg: `❌ 取得失敗: ${e.message}` });
    } finally {
      setLoading(false);
    }
  }

  function saveEntry() {
    if (!name.trim()) return;
    const next = [{ name, score, verdict, date: new Date().toLocaleDateString("ja-JP"), id: Date.now() }, ...saved];
    setSaved(next); save("gmgn_evals", next);
    setName(""); setWallet(""); setV({ hold: "", trades: "", winrate: "", unrealized: "" });
    setFetchStatus(null);
  }
  function remove(id) {
    const next = saved.filter(x => x.id !== id);
    setSaved(next); save("gmgn_evals", next);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ウォレット自動取得 */}
      <div style={cardStyle({ background: "rgba(0,229,160,0.04)", border: "1px solid rgba(0,229,160,0.15)" })}>
        <div style={{ fontWeight: 800, fontSize: 13, color: G, marginBottom: 10 }}>⚡ ウォレット自動評価</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            placeholder="Solanaウォレットアドレスをペースト"
            value={wallet}
            onChange={e => { setWallet(e.target.value); setFetchStatus(null); }}
            onKeyDown={e => e.key === "Enter" && fetchWallet()}
            style={{ ...inp, flex: 1, fontSize: 11 }}
          />
          <button
            onClick={fetchWallet}
            disabled={loading || !wallet.trim()}
            style={{
              padding: "9px 14px", borderRadius: 8, border: `1px solid ${G}44`,
              background: loading ? "rgba(255,255,255,0.04)" : G + "22",
              color: loading ? "#8a9bb5" : G,
              fontSize: 12, fontWeight: 700, cursor: loading ? "default" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {loading ? "取得中…" : "自動取得"}
          </button>
        </div>
        {fetchStatus && (
          <div style={{ marginTop: 8, fontSize: 11, color: fetchStatus.ok ? G : R }}>
            {fetchStatus.msg}
          </div>
        )}
      </div>

      {/* 入力フォーム */}
      <div style={cardStyle()}>
        <div style={{ fontWeight: 800, fontSize: 13, color: G, marginBottom: 12 }}>🔍 トレーダー評価</div>
        <input placeholder="トレーダー名（例: Game）" value={name}
          onChange={e => setName(e.target.value)} style={{ ...inp, marginBottom: 8 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {CRITERIA.map(c => (
            <div key={c.id}>
              <div style={{ fontSize: 10, color: "#8a9bb5", marginBottom: 3 }}>
                {c.label}（{c.unit}）
              </div>
              <input type="number" value={v[c.id]}
                onChange={e => setV(p => ({ ...p, [c.id]: e.target.value }))} style={inp} />
            </div>
          ))}
        </div>
        {/* スコア表示 */}
        <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 9,
          background: sc + "11", border: `1px solid ${sc}33`,
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 10, color: "#8a9bb5" }}>総合スコア</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: sc }}>
              {score}<span style={{ fontSize: 12 }}>点</span>
            </div>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: sc }}>{verdict}</div>
        </div>
        <button onClick={saveEntry} style={btnStyle(G)}>保存</button>
      </div>

      {/* 評価履歴 */}
      {saved.length > 0 && (
        <div style={cardStyle()}>
          <div style={{ fontWeight: 700, fontSize: 12, color: "#8a9bb5", marginBottom: 10 }}>📋 評価履歴</div>
          {saved.map(s => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", padding: "7px 0",
              borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div>
                <span style={{ fontWeight: 700, color: "#e8f0ff", fontSize: 12 }}>{s.name}</span>
                <span style={{ fontSize: 10, color: "#8a9bb5", marginLeft: 8 }}>{s.date}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 800,
                  color: s.score >= 70 ? G : s.score >= 45 ? Y : R }}>{s.score}点</span>
                <span style={{ fontSize: 12 }}>{s.verdict.slice(0, 1)}</span>
                <button onClick={() => remove(s.id)}
                  style={{ background: "none", border: "none", color: R + "66", cursor: "pointer", fontSize: 14 }}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 過去トレーダー */}
      <div style={cardStyle()}>
        <div style={{ fontWeight: 700, fontSize: 12, color: "#8a9bb5", marginBottom: 10 }}>📜 過去の評価</div>
        {PAST_TRADERS.map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center",
            padding: "6px 8px", borderRadius: 7, marginBottom: 4,
            background: t.active ? G + "0a" : "transparent",
            border: t.active ? `1px solid ${G}22` : "1px solid transparent" }}>
            <span style={{ fontSize: 13 }}>{t.verdict}</span>
            <span style={{ fontWeight: t.active ? 800 : 600,
              color: t.active ? G : "#c8d8f0", fontSize: 12, minWidth: 80 }}>{t.name}</span>
            <span style={{ fontSize: 11, color: "#8a9bb5" }}>{t.reason}</span>
            {t.active && <span style={{ marginLeft: "auto", fontSize: 10, color: G, fontWeight: 700 }}>コピー中</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  タブ2: 損益トラッカー
// ══════════════════════════════════════════════════════
function TrackerTab() {
  const [trades, setTrades] = useState(() => load("gmgn_trades", []));
  const [f, setF] = useState({ coin: "", buyPrice: "", sellPrice: "", myBuy: "", mySell: "", date: "" });

  function addTrade() {
    if (!f.coin || !f.buyPrice || !f.sellPrice) return;
    const tPnl = ((parseFloat(f.sellPrice) - parseFloat(f.buyPrice)) / parseFloat(f.buyPrice) * 100).toFixed(2);
    const mPnl = f.myBuy && f.mySell
      ? ((parseFloat(f.mySell) - parseFloat(f.myBuy)) / parseFloat(f.myBuy) * 100).toFixed(2)
      : null;
    const lag = f.myBuy
      ? ((parseFloat(f.myBuy) - parseFloat(f.buyPrice)) / parseFloat(f.buyPrice) * 100).toFixed(2)
      : null;
    const entry = { ...f, tPnl, mPnl, lag, id: Date.now(),
      date: f.date || new Date().toLocaleDateString("ja-JP") };
    const next = [entry, ...trades];
    setTrades(next); save("gmgn_trades", next);
    setF({ coin: "", buyPrice: "", sellPrice: "", myBuy: "", mySell: "", date: "" });
  }
  function remove(id) {
    const next = trades.filter(t => t.id !== id);
    setTrades(next); save("gmgn_trades", next);
  }

  const withPnl  = trades.filter(t => t.mPnl);
  const wins     = withPnl.filter(t => parseFloat(t.mPnl) > 0).length;
  const cumPnl   = trades.reduce((s, t) => s + (t.mPnl ? parseFloat(t.mPnl) : 0), 0);
  const lagLoss  = trades.filter(t => t.lag && parseFloat(t.lag) > 1 && t.mPnl && parseFloat(t.mPnl) < 0).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* サマリー */}
      {trades.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {[
            { l: "累計損益", v: `${cumPnl >= 0 ? "+" : ""}${cumPnl.toFixed(1)}%`, c: cumPnl >= 0 ? G : R },
            { l: "勝率",    v: `${withPnl.length ? Math.round(wins / withPnl.length * 100) : 0}%`, c: Y },
            { l: "遅延負け", v: `${lagLoss}件`, c: "#ff8a65" },
          ].map((s, i) => (
            <div key={i} style={{ ...cardStyle(), textAlign: "center", padding: "10px 6px" }}>
              <div style={{ fontSize: 10, color: "#8a9bb5", marginBottom: 3 }}>{s.l}</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: s.c }}>{s.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* 入力 */}
      <div style={cardStyle()}>
        <div style={{ fontWeight: 800, fontSize: 13, color: G, marginBottom: 12 }}>📝 トレード記録</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
          {[
            ["coin",      "コイン名（例: SPETTRO）", "text"],
            ["date",      "日付",                  "text"],
            ["buyPrice",  "トレーダー買い価格",      "number"],
            ["sellPrice", "トレーダー売り価格",      "number"],
            ["myBuy",     "自分の買い価格",          "number"],
            ["mySell",    "自分の売り価格",          "number"],
          ].map(([k, ph, tp]) => (
            <input key={k} placeholder={ph} type={tp} value={f[k]}
              onChange={e => setF(p => ({ ...p, [k]: e.target.value }))} style={inp} />
          ))}
        </div>
        <button onClick={addTrade} style={btnStyle(G)}>記録する</button>
      </div>

      {/* 履歴 */}
      {trades.length > 0 && (
        <div style={cardStyle()}>
          <div style={{ fontWeight: 700, fontSize: 12, color: "#8a9bb5", marginBottom: 10 }}>📊 取引履歴</div>
          {trades.map(t => {
            const isLL = t.lag && parseFloat(t.lag) > 1 && t.mPnl && parseFloat(t.mPnl) < 0;
            return (
              <div key={t.id} style={{ padding: "9px 10px", borderRadius: 9, marginBottom: 6,
                background: isLL ? R + "0a" : "rgba(255,255,255,0.04)",
                border: `1px solid ${isLL ? R + "33" : "rgba(255,255,255,0.06)"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <span style={{ fontWeight: 800, color: "#e8f0ff", fontSize: 12 }}>{t.coin}</span>
                    <span style={{ fontSize: 10, color: "#8a9bb5", marginLeft: 8 }}>{t.date}</span>
                    {isLL && <span style={{ marginLeft: 6, fontSize: 9, color: R, fontWeight: 700 }}>⚠遅延負け</span>}
                  </div>
                  <button onClick={() => remove(t.id)}
                    style={{ background: "none", border: "none", color: R + "55", cursor: "pointer", fontSize: 13 }}>×</button>
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 5 }}>
                  <span style={{ fontSize: 11 }}>
                    <span style={{ color: "#8a9bb5" }}>先：</span>
                    <span style={{ color: parseFloat(t.tPnl) >= 0 ? G : R, fontWeight: 700 }}>
                      {parseFloat(t.tPnl) >= 0 ? "+" : ""}{t.tPnl}%
                    </span>
                  </span>
                  {t.mPnl && (
                    <span style={{ fontSize: 11 }}>
                      <span style={{ color: "#8a9bb5" }}>自分：</span>
                      <span style={{ color: parseFloat(t.mPnl) >= 0 ? G : R, fontWeight: 700 }}>
                        {parseFloat(t.mPnl) >= 0 ? "+" : ""}{t.mPnl}%
                      </span>
                    </span>
                  )}
                  {t.lag && (
                    <span style={{ fontSize: 11 }}>
                      <span style={{ color: "#8a9bb5" }}>遅延：</span>
                      <span style={{ color: parseFloat(t.lag) > 2 ? "#ff8a65" : "#8a9bb5", fontWeight: 700 }}>
                        +{t.lag}%
                      </span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  タブ3: 設定メモ
// ══════════════════════════════════════════════════════
function SettingsTab() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={cardStyle()}>
        <div style={{ fontWeight: 800, fontSize: 13, color: G, marginBottom: 12 }}>⚙️ 推奨設定（Game）</div>
        {SETTINGS.map((s, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between",
            padding: "8px 10px", borderRadius: 7,
            background: i % 2 === 0 ? "rgba(255,255,255,0.04)" : "transparent" }}>
            <span style={{ fontSize: 11, color: "#8a9bb5" }}>{s.label}</span>
            <span style={{ fontSize: 11, color: "#e8f0ff", fontWeight: 600 }}>{s.value}</span>
          </div>
        ))}
      </div>
      <div style={cardStyle()}>
        <div style={{ fontWeight: 800, fontSize: 13, color: Y, marginBottom: 12 }}>💡 重要な教訓</div>
        {LESSONS.map((l, i) => (
          <div key={i} style={{ display: "flex", gap: 9, marginBottom: 8,
            padding: "7px 9px", borderRadius: 7,
            background: Y + "08", border: `1px solid ${Y}18` }}>
            <span style={{ color: Y, fontWeight: 800, fontSize: 12 }}>{i + 1}</span>
            <span style={{ fontSize: 11, color: "#c8d8f0", lineHeight: 1.6 }}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  タブ4: 残高管理
// ══════════════════════════════════════════════════════
function BalanceTab() {
  const [bal, setBal]             = useState(() => load("gmgn_sol", 3.4123));
  const [inp2, setInp2]           = useState("");
  const [withdrawals, setW]       = useState(() => load("gmgn_withdrawals", []));
  const [wf, setWf]               = useState({ amount: "", note: "", date: "" });

  function updateBal() {
    const n = parseFloat(inp2);
    if (isNaN(n)) return;
    setBal(n); save("gmgn_sol", n); setInp2("");
  }
  function addW() {
    if (!wf.amount) return;
    const next = [{ ...wf, id: Date.now(), date: wf.date || new Date().toLocaleDateString("ja-JP") }, ...withdrawals];
    setW(next); save("gmgn_withdrawals", next);
    setWf({ amount: "", note: "", date: "" });
  }
  function removeW(id) {
    const next = withdrawals.filter(w => w.id !== id);
    setW(next); save("gmgn_withdrawals", next);
  }

  const now = new Date();
  const monthTotal = withdrawals
    .filter(w => { const d = new Date(w.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); })
    .reduce((s, w) => s + parseFloat(w.amount || 0), 0);
  const crit = bal < 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 残高カード */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={cardStyle({ background: crit ? R + "12" : G + "08", border: `1px solid ${crit ? R + "44" : G + "33"}` })}>
          <div style={{ fontSize: 10, color: "#8a9bb5", marginBottom: 3 }}>現在残高</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: crit ? R : G }}>
            {bal.toFixed(4)}<span style={{ fontSize: 11 }}> SOL</span>
          </div>
          {crit && <div style={{ fontSize: 10, color: R, marginTop: 3, fontWeight: 700 }}>⚠ コピー停止推奨</div>}
        </div>
        <div style={cardStyle()}>
          <div style={{ fontSize: 10, color: "#8a9bb5", marginBottom: 3 }}>今月出金</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: Y }}>¥{monthTotal.toLocaleString()}</div>
          <div style={{ fontSize: 9, color: "#8a9bb5", marginTop: 2 }}>目標 ¥600,000</div>
          <div style={{ height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 2, marginTop: 5 }}>
            <div style={{ height: "100%", width: `${Math.min(monthTotal / 600000 * 100, 100)}%`, background: Y, borderRadius: 2 }} />
          </div>
        </div>
      </div>

      {/* 残高更新 */}
      <div style={cardStyle()}>
        <div style={{ fontWeight: 700, fontSize: 12, color: G, marginBottom: 10 }}>💎 残高更新</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="number" placeholder="現在のSOL残高" value={inp2}
            onChange={e => setInp2(e.target.value)} style={{ ...inp, flex: 1 }} />
          <button onClick={updateBal} style={{
            padding: "9px 14px", background: G + "22", border: `1px solid ${G}44`,
            borderRadius: 8, color: G, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>更新</button>
        </div>
      </div>

      {/* 出金記録 */}
      <div style={cardStyle()}>
        <div style={{ fontWeight: 700, fontSize: 12, color: Y, marginBottom: 10 }}>💴 出金記録（Redotpay）</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7 }}>
          <input placeholder="金額（円）" type="number" value={wf.amount}
            onChange={e => setWf(p => ({ ...p, amount: e.target.value }))} style={inp} />
          <input placeholder="日付" value={wf.date}
            onChange={e => setWf(p => ({ ...p, date: e.target.value }))} style={inp} />
          <input placeholder="メモ" value={wf.note}
            onChange={e => setWf(p => ({ ...p, note: e.target.value }))} style={inp} />
        </div>
        <button onClick={addW} style={btnStyle(Y)}>記録する</button>
        {withdrawals.map(w => (
          <div key={w.id} style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", padding: "7px 8px", borderRadius: 7, marginTop: 6,
            background: "rgba(255,255,255,0.04)" }}>
            <div>
              <span style={{ fontWeight: 700, color: Y, fontSize: 12 }}>¥{parseFloat(w.amount).toLocaleString()}</span>
              <span style={{ fontSize: 10, color: "#8a9bb5", marginLeft: 8 }}>{w.date}</span>
              {w.note && <span style={{ fontSize: 10, color: "#8a9bb5", marginLeft: 6 }}>{w.note}</span>}
            </div>
            <button onClick={() => removeW(w.id)}
              style={{ background: "none", border: "none", color: R + "55", cursor: "pointer", fontSize: 13 }}>×</button>
          </div>
        ))}
      </div>

      {/* ATM注意 */}
      <div style={cardStyle({ background: "#ff8a6508", border: "1px solid #ff8a6530" })}>
        <div style={{ fontWeight: 700, fontSize: 12, color: "#ff8a65", marginBottom: 8 }}>🏧 ATM出金の注意</div>
        <div style={{ fontSize: 11, color: "#c8d8f0", lineHeight: 1.9 }}>
          ✅ <strong>「Accept without conversion」</strong>を選択<br />
          ❌ 「Accept with conversion」は<strong> +4%の余分な手数料</strong>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  メインApp
// ══════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState(0);
  const tabs = ["🔍 評価", "📊 損益", "⚙️ 設定", "💴 残高"];

  return (
    <div style={{ minHeight: "100vh", background: "#0a0f1a",
      fontFamily: "'Helvetica Neue', sans-serif", color: "#e8f0ff", paddingBottom: 40 }}>

      {/* ヘッダー */}
      <div style={{ padding: "16px 16px 0", borderBottom: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(0,229,160,0.03)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: G }}>GMGN</span>
          <span style={{ fontSize: 11, color: "#8a9bb5", fontWeight: 600 }}>コピートレード管理ダッシュボード</span>
        </div>
        <div style={{ fontSize: 10, color: "#8a9bb5", marginBottom: 12 }}>
          コピー中: <span style={{ color: G, fontWeight: 700 }}>Game</span>
          <span style={{ marginLeft: 10 }}>保有33日 · 勝率56% · 未実現+$0</span>
        </div>
        <div style={{ display: "flex", gap: 6, paddingBottom: 1 }}>
          {tabs.map((t, i) => (
            <button key={i} onClick={() => setTab(i)} style={{
              padding: "7px 14px", borderRadius: 8, border: "none",
              cursor: "pointer", fontSize: 12, fontWeight: 700,
              background: tab === i ? G : "rgba(255,255,255,0.06)",
              color: tab === i ? "#0a0f1a" : "#8a9bb5",
              transition: "all 0.15s",
              boxShadow: tab === i ? `0 2px 10px ${G}44` : "none",
            }}>{t}</button>
          ))}
        </div>
      </div>

      {/* コンテンツ */}
      <div style={{ padding: "14px 14px 0" }}>
        {tab === 0 && <EvalTab />}
        {tab === 1 && <TrackerTab />}
        {tab === 2 && <SettingsTab />}
        {tab === 3 && <BalanceTab />}
      </div>
    </div>
  );
}
