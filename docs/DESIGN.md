# GMGN トレーダー知能エンジン — 完全設計書 v1.0

> 本書は後続実装（Sonnet 5 想定）のための一次仕様である。
> 曖昧さを排除するため、数値・閾値・型・API・画面はすべて確定値で記述する。
> 実装時に判断が必要な箇所は「⚠ 実装判断」と明示した。

---

## 0. 前提と設計上の現実制約（最重要）

### 0.1 データ取得の現実

本セッションで実測済みの制約：

| データソース | 状態 | 詳細 |
|---|---|---|
| GMGN 非公式API (`/defi/quotation/v1/smartmoney/...`) | ❌ 使用不可 | Cloudflare IP から 403。smart money DB 未登録ウォレットは `40000300 invalid argument` |
| Birdeye API | ❌ 却下 | 無料枠なし（ユーザー要件：完全無料） |
| Solana 公式 RPC (`api.mainnet-beta.solana.com`) | ✅ 稼働中 | 無料・認証不要。ただしレート制限あり（~100 req/10s） |
| Jupiter Price API (`price.jup.ag/v6`) | ✅ 稼働中 | 無料・認証不要 |
| GMGN Web UI（人間の閲覧） | ✅ 可能 | ユーザーが画面からコピペ可能 |

### 0.2 これが設計に与える帰結

1. **Discovery（全 GMGN トレーダーの自動走査）は API では実現不可能。**
   → MVP の Discovery は「候補プール方式」とする：ユーザーが GMGN のランキング画面からアドレス群を貼り付け（複数行ペースト / CSV）、アプリ側がプール内を分析・ランキングする。
2. **統計値は 2 系統のソースを持つ：**
   - `manual`: GMGN UI からユーザーが転記した値（信頼度: 高、鮮度: 手動）
   - `rpc`: Solana RPC + Jupiter から自動計算した値（信頼度: 中、鮮度: 自動）
   両者をマージし、`manual` を優先する（フィールド単位）。
3. **分析エンジンはデータソース非依存の純粋関数モジュール**として実装し、将来 GMGN 公式 API / Helius 等が使えるようになったらアダプタ追加のみで対応する。

### 0.3 技術スタック（確定）

元要件は Next.js だが、**既存の稼働資産を優先し現行スタックを継続する**：

| レイヤ | 技術 | 理由 |
|---|---|---|
| Frontend | React 18 + Vite（既存） | 既にビルド・デプロイパイプライン稼働中 |
| Backend | Cloudflare Pages Functions（既存 `functions/`） | サーバーレス、CORS 回避プロキシ実績あり |
| 分析エンジン | `src/engine/` 配下の純粋 TS/JS モジュール | フロント・バック両方から import 可能、単体テスト容易 |
| 永続化 (MVP) | localStorage | 既存実装踏襲。キー設計は §6 |
| 永続化 (拡張) | Cloudflare KV | Pages Functions からバインド可能 |
| デプロイ | GitHub Actions → wrangler pages deploy（既存） | 変更不要 |

⚠ 実装判断: Next.js への移行は行わない。行う場合は本書の全 API パスをそのまま `app/api/` に写像可能。

---

## 1. 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser (React SPA)                      │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │Dashboard │ │Discovery │ │Validation│ │ Comparison    │  │
│  │  (切替)   │ │  MODE A  │ │  MODE B  │ │ + Risk Panel │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘  │
│       └────────────┴─────┬──────┴───────────────┘          │
│                          ▼                                  │
│              ┌───────────────────────┐                      │
│              │  src/engine/ (純粋関数) │                      │
│              │  - score.js  スコア計算  │                      │
│              │  - classify.js 分類     │                      │
│              │  - gates.js  NG判定     │                      │
│              │  - merge.js  ソース統合  │                      │
│              └──────────┬────────────┘                      │
│                         ▼                                   │
│              ┌───────────────────────┐                      │
│              │ src/store/ (localStorage)│                    │
│              │  traders / scores / ng  │                     │
│              └───────────────────────┘                      │
└──────────────────────────┬──────────────────────────────────┘
                           │ fetch /api/*
                           ▼
┌─────────────────────────────────────────────────────────────┐
│           Cloudflare Pages Functions (functions/)            │
│                                                             │
│  /api/wallet/[address]   単一ウォレット RPC 統計（既存・拡張）  │
│  /api/analyze            バッチ分析（複数アドレス）             │
│  /api/health             疎通確認                            │
└──────────────┬──────────────────────┬───────────────────────┘
               ▼                      ▼
     Solana Mainnet RPC        Jupiter Price API
     (無料・認証不要)            (無料・認証不要)
```

**設計原則：**
- スコアリング・分類・NG判定は**すべてクライアント側の `src/engine/` で実行**する。Pages Functions は「生データ取得」のみを担う。理由：無料枠の CPU 時間制約回避、オフライン再計算可能、エンジンの単体テスト容易性。
- `src/engine/` は React に依存しない（`import` されるだけの純粋関数群）。

---

## 2. データ設計（確定型定義）

`src/engine/types.d.ts` として配置（実装は JSDoc でも可）。

```typescript
/** 30日ウィンドウのトレーダー生統計。null = そのソースでは取得不能 */
interface TraderStats {
  address: string;              // Solana アドレス（base58, 32-44文字）
  label: string | null;         // ユーザー命名（例: "Gameトレーダー"）
  avgHoldingHours: number | null;   // 平均保有時間（時間単位で正規化）
  winRate: number | null;           // 0–100
  dailyTrades: number | null;       // 1日平均取引回数
  tradeCount30d: number | null;     // 30日取引総数
  realizedPnlUsd: number | null;    // 実現損益 USD
  unrealizedPnlUsd: number | null;  // 未実現損益 USD
  shortTermRatio: number | null;    // 保有1時間未満の取引比率 0–1
  monthlyPnl: number[] | null;      // 直近最大6ヶ月の月次PnL（古→新）
  source: "manual" | "rpc" | "merged";
  fetchedAt: string;            // ISO 8601
}

/** スコア計算結果 */
interface Score {
  totalScore: number;        // 0–100（ゲート落ちは 0）
  grade: "A" | "B" | "C" | "D";
  holdingScore: number;      // 0–100
  stabilityScore: number;    // 0–100
  winRateScore: number;      // 0–100
  riskScore: number;         // 0–100
  executionScore: number;    // 0–100
  dataCompleteness: number;  // 0–1: null でなかった指標の重み合計
}

/** NG ゲート判定結果 */
interface GateResult {
  passed: boolean;
  failures: GateFailure[];   // passed=true なら空配列
}
interface GateFailure {
  gateId: "G1_SCALP_HOLD" | "G2_SCALP_RATIO" | "G3_UNDERWATER"
        | "G4_FAKE_WINRATE" | "G5_OVERTRADING";
  reasonJa: string;          // UI 表示用の日本語理由
  value: number;             // 実測値
  threshold: number;         // 閾値
}

/** トレーダー分類 */
type StrategyType =
  | "SWING_STABLE"     // スイング安定型（理想）
  | "MID_TREND"        // 中期トレンド型（良）
  | "SCALPING"         // スキャルピング型（NG）
  | "BAG_HOLDER"       // 塩漬け型（リスク）
  | "GAMBLER"          // ギャンブル型（NG）
  | "UNKNOWN";         // データ不足

/** 最終判定 */
interface Verdict {
  decision: "COPY_OK" | "CONDITIONAL" | "NG" | "INSUFFICIENT_DATA";
  score: Score;
  strategyType: StrategyType;
  gate: GateResult;
  warnings: string[];        // CONDITIONAL の条件（日本語）
  reasonsJa: string[];       // 判定理由の箇条書き（最重要出力・必ず3件以上）
  evaluatedAt: string;       // ISO 8601
}
```

---

## 3. スコアリングアルゴリズム詳細（確定仕様）

配置: `src/engine/score.js`, `src/engine/gates.js`, `src/engine/classify.js`

### 3.1 パイプライン順序（厳守）

```
TraderStats
  → (1) 取引数チェック       tradeCount30d < 5 → INSUFFICIENT_DATA で終了
                              （個々の指標の欠損は (5) の重み付きチェックに委ねる。
                               monthlyPnl は RPC単独では原理的に取得不能なため、
                               主要指標カウントに含めて一律に落とすと過度に厳しくなる）
  → (2) NG ゲート (gates.js)  1つでも該当 → decision=NG, totalScore=0,
                              grade=D で終了（分類だけは実行して表示）
  → (3) 分類 (classify.js)
  → (4) 成分スコア計算 (score.js)
  → (5) 総合スコア・グレード。dataCompleteness < 0.5 → INSUFFICIENT_DATA
  → (6) 判定 (verdict.js)
  → (7) 理由文生成 (reasons.js)
```

### 3.2 NG ゲート（即時除外・OR 判定）

| ID | 条件 | 閾値根拠 |
|---|---|---|
| `G1_SCALP_HOLD` | `avgHoldingHours < 24` | 保有24h未満はコピー時のスリッページ・遅延で構造的に不利 |
| `G2_SCALP_RATIO` | `shortTermRatio > 0.5` | 半数以上が1h未満保有 = 実質スキャルパー |
| `G3_UNDERWATER` | `unrealizedPnlUsd < -0.5 × max(|realizedPnlUsd|, 1000)` | 実現益の見せかけ・大幅含み損の隠れ損失 |
| `G4_FAKE_WINRATE` | `winRate ≥ 85 && avgHoldingHours < 72` | 高勝率×短期保有は「小さく勝って大きく負ける」偽陽性パターン |
| `G5_OVERTRADING` | `dailyTrades > 20` | コピー実行が物理的に追随不能（1回0.3 SOL × 20回/日 = 資金破綻） |

- 指標が `null` のゲートは**スキップ**する（判定不能で落とさない）。ただしスキップしたゲートは `warnings` に「G◯未検証（データ不足）」を追加する。

### 3.3 成分スコア（各 0–100）

**重み（合計 1.00）：**

| 成分 | 重み | 設計思想 |
|---|---|---|
| holdingScore | **0.35** | 保有時間が最重要（本書の核心思想） |
| stabilityScore | 0.25 | 月次の安定性 > 瞬間風速 |
| winRateScore | 0.15 | 勝率は過信禁止のため低め |
| riskScore | 0.15 | 含み損の健全性 |
| executionScore | 0.10 | コピー追随可能性（slippage 耐性） |

#### (a) holdingScore — 区分線形補間

`d = avgHoldingHours / 24`（日数）に対し、以下のアンカー点を**線形補間**：

| d (日) | score | 意味 |
|---|---|---|
| 0 | 0 | |
| 1 | 10 | ゲート境界 |
| 3 | 45 | |
| 7 | 80 | 中期の入り口 |
| 14 | 100 | 理想帯の開始 |
| 45 | 100 | 理想帯の終了（現コピー中の33日はこの帯） |
| 90 | 60 | 長期化はリスク増 |
| 180+ | 30 | 塩漬け域 |

```javascript
const HOLD_ANCHORS = [[0,0],[1,10],[3,45],[7,80],[14,100],[45,100],[90,60],[180,30]];
function holdingScore(hours) {
  const d = hours / 24;
  return piecewiseLinear(HOLD_ANCHORS, Math.min(d, 180));
}
```

#### (b) stabilityScore — 月次PnLの正月率 × 変動係数ペナルティ

```javascript
function stabilityScore(monthlyPnl) {
  if (!monthlyPnl || monthlyPnl.length < 2) return null;  // 欠損扱い
  const posRatio = monthlyPnl.filter(x => x > 0).length / monthlyPnl.length;
  const mean = avg(monthlyPnl);
  const cv = mean === 0 ? 2 : Math.min(stddev(monthlyPnl) / Math.abs(mean), 2);
  // 正月率 70%、変動の小ささ 30%
  return 100 * (0.7 * posRatio + 0.3 * (1 - cv / 2));
}
```

#### (c) winRateScore — 過信禁止の非対称マッピング

| winRate | 条件 | score |
|---|---|---|
| < 35 | — | `winRate / 35 × 40`（0–40 線形） |
| 35–65 | — | `40 + (winRate-35)/30 × 60`（40–100 線形。**55–65% が満点近傍**） |
| 65–85 | `avgHoldingHours ≥ 168`（7日以上） | 100（長期×高勝率は本物） |
| 65–85 | `avgHoldingHours < 168` | 70（短中期の高勝率は割引） |
| ≥ 85 | — | 50（ゲート未該当でも異常値として大幅割引） |

#### (d) riskScore — 含み損健全性

`r = unrealizedPnlUsd / max(|realizedPnlUsd|, 1000)` に対し：

| r | score |
|---|---|
| ≥ 0 | 100 |
| [-0.1, 0) | 85 |
| [-0.25, -0.1) | 60 |
| [-0.5, -0.25) | 30 |
| < -0.5 | 0（G3 ゲート域） |

#### (e) executionScore — コピー追随可能性

`dailyTrades` に対する区分線形（アンカー: `[0,50],[0.2,80],[0.5,100],[3,100],[6,60],[10,30],[20,10]`）。
思想: 1日 0.5–3 回が理想。過少は機会損失、過多は 0.3 SOL 固定ロットで資金が持たない＋スリッページ累積。

#### (f) 欠損値の扱い（確定ルール）

- 成分スコアが `null`（データ欠損）の場合、**その成分を除外して重みを再正規化**する。
- `dataCompleteness` = 使用できた成分の元重み合計。
- `dataCompleteness < 0.5` の場合は `INSUFFICIENT_DATA` に格下げする。

```javascript
function totalScore(components) {
  const entries = Object.entries(WEIGHTS).filter(([k]) => components[k] != null);
  const wSum = entries.reduce((s, [,w]) => s + w, 0);
  if (wSum < 0.5) return { total: null, completeness: wSum };
  const total = entries.reduce((s, [k,w]) => s + components[k] * w, 0) / wSum;
  return { total: Math.round(total), completeness: wSum };
}
```

### 3.4 グレードと最終判定

| grade | totalScore |
|---|---|
| A | 80–100 |
| B | 65–79 |
| C | 50–64 |
| D | 0–49 またはゲート落ち |

| decision | 条件 |
|---|---|
| `COPY_OK` | grade A、または grade B かつ `warnings.length === 0` |
| `CONDITIONAL` | grade B かつ warnings あり、または grade C かつ分類が SWING_STABLE/MID_TREND |
| `NG` | ゲート落ち、grade D、分類 SCALPING/GAMBLER |
| `INSUFFICIENT_DATA` | §3.1(1) 該当、または completeness < 0.5 |

**warnings 生成規則（CONDITIONAL の条件文）:**
- `dataCompleteness < 0.8` → 「一部指標が未取得（RPC推計のみ）。GMGN画面の値で補完推奨」
- `monthlyPnl` が 3ヶ月未満 → 「運用履歴が浅い。0.1 SOL での試験コピー推奨」
- 分類 BAG_HOLDER → 「塩漬け傾向。SL -60% 到達前の手動監視必須」
- `avgHoldingHours > 45*24` → 「保有が長期化傾向。資金回転率に注意」

### 3.5 トレーダー分類（優先順位つき if-else、最初に該当したもの）

```
1. SCALPING:    avgHoldingHours < 24  OR shortTermRatio > 0.5
2. GAMBLER:     winRate < 35 AND (dailyTrades > 5 OR cv(monthlyPnl) > 1.5)
3. BAG_HOLDER:  avgHoldingHours > 90*24 OR riskScore ≤ 30
4. SWING_STABLE: 7*24 ≤ avgHoldingHours ≤ 60*24 AND dailyTrades ≤ 3
                 AND 40 ≤ winRate ≤ 80
5. MID_TREND:   3*24 ≤ avgHoldingHours < 7*24 AND dailyTrades ≤ 5
6. UNKNOWN:     上記いずれにも該当しない、または判定に必要な指標が null
```

### 3.6 理由説明の生成（§出力構造⑦・最重要）

`src/engine/reasons.js`。テンプレート方式（LLM 不使用・決定的）。必ず以下の順で最低3文を生成：

1. **結論文**: 「総合{score}点・{grade}判定。{分類日本語名}に分類されます。」
2. **最強要因**: 成分スコア×重みの寄与が最大の項目について定型文（例: 「平均保有{d}日は理想帯（14–45日）に収まり、コピー時のスリッページ影響を受けにくい構造です。」）
3. **最弱要因**: 寄与最小の項目の定型文
4. **ゲート落ち時**: 各 `GateFailure.reasonJa` を列挙
5. **運用ルール適合性**: ユーザー設定（0.3 SOL / SL-60% / TPなし）との適合コメント
   - 例: `avgHoldingHours ≥ 14日` → 「SL-60%・TPなし運用と相性が良い（長期保有前提のため）」
   - 例: `dailyTrades > 3` → 「1回0.3 SOL固定では1日{n}回のコピーで日次{0.3n} SOL必要。資金計画に注意」

---

## 4. API 設計（Cloudflare Pages Functions）

### 4.1 エンドポイント一覧

| Method | Path | 用途 | 実装状態 |
|---|---|---|---|
| GET | `/api/wallet/:address` | 単一ウォレットの RPC 統計 | ✅ 既存（§4.2 へ拡張） |
| POST | `/api/analyze` | 複数アドレスの一括 RPC 統計 | 🆕 |
| GET | `/api/health` | 疎通・RPC 生存確認 | 🆕 |

スコア計算 API は**作らない**（エンジンはクライアント実行、§1 参照）。

### 4.2 GET `/api/wallet/:address` — レスポンス確定形

既存実装を以下の形に拡張する（フィールド名は既存 `App.jsx` のマッピングと後方互換）：

```json
{
  "data": {
    "unrealized_profit": "1234",
    "winrate": null,
    "avg_hold_duration": 79.5,
    "trade_count_30d": 25,
    "short_term_ratio": 0.12,
    "daily_trades": 0.8
  },
  "_source": "solana-rpc",
  "_completeness": 0.85,
  "_fetchedAt": "2026-07-11T00:00:00Z"
}
```

**追加実装仕様（既存コードからの差分）:**

- `winrate`: RPCの残高差分だけでは**常に `null`**。理由: 「あるミントが増えて別のミントが減った」というスワップ検知は、買い・売りのどちらでも成立してしまう（買いはSOL側が減りトークン側が増える、売りはその逆）。この方式で「勝ち」を判定すると、ほぼ全スワップが勝ちに分類され、実際に観測された（保有時間0.0h・短期比率100%のウォレットが勝率100%と誤表示される）。真の勝率は取得原価が必要なためRPC単独では算出不能と判断し、意図的に `null` を返す。GMGN画面の値を手動入力すること
- `avg_hold_duration`（時間単位）: 以下のアルゴリズムで**推計値**を返す：
  1. 直近 200 署名から、サブリクエスト予算の範囲内（最大60件）でパースした tx のうち、`blockTime` が取得できたものだけを対象に、トークン残高変化を時系列に整列
  2. **ラップドSOL（`So111...112`）は除外**する。ほぼ全スワップがルーティングでSOL⇄WSOLを経由するため、含めると経路上の一瞬の残高変化を「即売買」と誤検知し、実際の対象トークンの保有時間を覆い隠してしまう
  3. ミントごとに「残高が 0→正 になった時刻（初回買い）」と「正→減少した時刻（売り）」をペアリング
  4. ペア成立したものの保有時間の中央値を返す。ペアが `MIN_HOLD_PAIRS`（2）組未満なら `null`。ちょうど2組の場合は参考値として `_warnings` に記録する
- `short_term_ratio`: 上記（WSOL除外後の）ペアのうち保有 < 1h の比率。ペアが `MIN_HOLD_PAIRS` 未満なら `null`
- RPC レート制限・ブロック対策: 無料公開RPCを複数（PublicNode/Ankr/dRPC/公式）フォールバックし、成功したエンドポイントを次回優先。`getTokenAccountsByOwner` のような広く制限されがちな高コストメソッドは試行数を絞り、失敗時は SolanaFM のベストエフォート・フォールバックを試す。`getTransaction` の並列数は 5 に制限
- サブリクエスト予算管理: Cloudflare Pages Functions の1リクエストあたり外部fetch数上限を踏まえ、リクエスト単位で予算（45件目安）を管理し、tx サンプル数を動的に調整する。予算で切り詰めた場合は `_warnings` に記録
- 60 秒キャッシュ: `caches.default`（Cloudflare Cache API）に `Cache-Control: max-age=60` で格納

### 4.3 POST `/api/analyze`

```
Request:  { "addresses": ["addr1", "addr2", ...] }   // 最大 20 件
Response: { "results": [ { "address": "...", ...(§4.2のdata形) }, ... ],
            "errors":  [ { "address": "...", "error": "..." } ] }
```

- 内部で `/api/wallet` 相当の処理を**直列 + 200ms 間隔**で実行（RPC レート制限保護）
- 20 件超は `400 { "error": "max 20 addresses" }`

### 4.4 エラー形式（全エンドポイント共通）

```json
{ "error": "human readable message", "code": "RATE_LIMITED" | "INVALID_ADDRESS" | "RPC_ERROR" }
```
HTTP status: 400（入力不正）/ 429（レート）/ 502（上流RPC失敗）

---

## 5. UI 設計（ワイヤーフレーム確定）

既存 `App.jsx` のタブ構造を拡張。タブ: `[ダッシュボード] [🔍発見] [📋分析] [⚖比較] [履歴]`

### 5.1 Dashboard（モード切替ハブ）

```
┌──────────────────────────────────────────────┐
│ GMGN トレーダー知能エンジン        [🔍発見][📋分析] │
├──────────────────────────────────────────────┤
│ ┌─ 現在コピー中 ──────────────────────────┐   │
│ │ Gameトレーダー   スコア 78 (B)  ✅COPY_OK │   │
│ │ 保有33日 | 勝率56% | 未実現±0 | スイング安定型│   │
│ └──────────────────────────────────────┘   │
│ ┌─ 運用ルール ────────────────────────────┐   │
│ │ 1回 0.3 SOL | SL -60% | TPなし          │   │
│ │ Dev Sell 25% / Auto 100%      [編集]    │   │
│ └──────────────────────────────────────┘   │
│ ┌─ 🟥 Risk Panel ─────────────────────────┐   │
│ │ ⚠ 監視中トレーダーのアラート 0 件           │   │
│ └──────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

### 5.2 Discovery 画面（MODE A）

```
┌──────────────────────────────────────────────┐
│ 候補プール登録                                   │
│ ┌──────────────────────────────────────┐     │
│ │ アドレスを1行1件で貼り付け（GMGNランキングから）│     │
│ │ 7xKX...   ← textarea 複数行              │     │
│ └──────────────────────────────────────┘     │
│ [一括分析 (最大20件)]                            │
├──────────────────────────────────────────────┤
│ フィルター: 勝率[40]–[80]% 保有[7]–[60]日          │
│           取引回数/日 ≤[3]  □NGを隠す            │
├──────────────────────────────────────────────┤
│ 🏆 候補ランキング TOP20                          │
│ #1 7xKX…9fQ  86(A) スイング安定 ✅ [詳細][比較+]  │
│ #2 3mPa…2dR  74(B) 中期トレンド ⚠  [詳細][比較+]  │
│ ...                                          │
├──────────────────────────────────────────────┤
│ 🚫 NGリスト（除外理由つき）                        │
│ 9qWe…1xZ  スキャルピング型 — 平均保有4.2h (G1)     │
│ 5tYu…8vB  偽陽性勝率 — 勝率91%×保有2.1日 (G4)     │
└──────────────────────────────────────────────┘
```

### 5.3 Validation 画面（MODE B）— 既存「⚡ウォレット自動評価」を拡張

```
┌──────────────────────────────────────────────┐
│ ウォレット入力 [7xKX…____________] [🔍分析]       │
│ 補完入力（GMGN画面から転記・任意）:                 │
│  保有[  ]日 勝率[  ]% 回数[  ]/日 未実現[  ]$      │
├──────────────────────────────────────────────┤
│ ┌── 分析結果カード ──────────────────────────┐  │
│ │  総合 78/100  grade B   ⚠ CONDITIONAL     │  │
│ │  分類: スイング安定型                        │  │
│ │  ├ 保有時間   92  █████████▏ (w35%)        │  │
│ │  ├ 安定性     71 ███████     (w25%)        │  │
│ │  ├ 勝率品質   88 ████████▊   (w15%)        │  │
│ │  ├ リスク     60 ██████      (w15%)        │  │
│ │  └ 追随性    100 ██████████  (w10%)        │  │
│ │  データ充足度 85%（RPC推計を含む）             │  │
│ │  ── 判定理由 ──────────────────────       │  │
│ │  ・総合78点・B判定。スイング安定型です          │  │
│ │  ・平均保有21日は理想帯(14–45日)…            │  │
│ │  ・含み損が実現益の18%あり、リスク項目が弱い     │  │
│ │  ・SL-60%/TPなし運用と相性良好               │  │
│ │  [評価履歴に保存] [比較に追加]                │  │
│ └──────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

### 5.4 Comparison 画面

最大4体を列比較。行 = 総合/成分スコア/分類/判定/主要生値。各行の最良セルを緑ハイライト。

### 5.5 Risk Panel（Dashboard 内 + 独立タブは作らない）

- 保存済みトレーダーの**再分析時**に前回スコアと比較し：
  - `totalScore` が 15 点以上下落 → 「📉 スコア急落」アラート
  - 分類が SWING_STABLE → SCALPING/GAMBLER に遷移 → 「🚨 戦略変化検知」
  - 新規ゲート落ち → 「🚫 NG化」
- アラートは `localStorage` の `alerts` に追記し Dashboard に表示。既読で消去。

### 5.6 コンポーネント構成（実装指示）

```
src/
  engine/           # 純粋関数（React非依存・単体テスト対象）
    score.js  gates.js  classify.js  verdict.js  reasons.js  merge.js
  components/
    ScoreCard.jsx        # 5.3 の結果カード
    ScoreBar.jsx         # 成分スコアバー
    RankingTable.jsx     # 5.2 ランキング
    NgList.jsx
    ComparisonGrid.jsx
    RiskAlerts.jsx
    WalletInput.jsx      # アドレス検証つき入力（base58, 32–44字）
  store/
    traders.js           # localStorage CRUD（§6）
  App.jsx                # タブ制御のみ（肥大化解消のため分割）
```

---

## 6. データフローと永続化

### 6.1 分析フロー（Validation）

```
ユーザー入力(アドレス + 任意の手動値)
  → fetch /api/wallet/:addr ──失敗──→ 手動値のみで続行（source="manual"）
  → merge.js: manual > rpc のフィールド単位マージ（source="merged"）
  → engine パイプライン（§3.1）
  → Verdict を ScoreCard に描画
  → [保存] → localStorage("gmgn.traders.v1")
```

### 6.2 Discovery フロー

```
複数アドレス貼付 → 形式検証 → POST /api/analyze（20件ずつ）
  → 各 result を engine に通す → Verdict[] 
  → passed → RankingTable（totalScore 降順）
  → gated  → NgList（GateFailure.reasonJa 表示）
  → プール全体を localStorage("gmgn.pool.v1") に保存
```

### 6.3 localStorage スキーマ（バージョンキー必須）

| キー | 型 | 内容 |
|---|---|---|
| `gmgn.traders.v1` | `Record<address, {stats, verdict, history: Verdict[]}>` | 保存済みトレーダー。history は最大20件で FIFO |
| `gmgn.pool.v1` | `address[]` | Discovery 候補プール |
| `gmgn.rules.v1` | `{buySOL:0.3, slPct:-60, tpPct:null, devSellPct:25, autoSellPct:100}` | 運用ルール |
| `gmgn.alerts.v1` | `Alert[]` | Risk Panel 用 |

既存キー（評価履歴・取引記録・SOL残高・出金記録）は**変更しない**。移行コードも不要（併存）。

---

## 7. ロードマップ

### Phase 1 — MVP（本設計の実装範囲）
1. `src/engine/` 一式 + 単体テスト（vitest、閾値表のテーブル駆動テスト）
2. `/api/wallet` 拡張（hold時間推計・short_term_ratio・並列5制限・60sキャッシュ）
3. `/api/analyze` 新設
4. Validation 画面刷新（ScoreCard + 手動補完入力 + マージ）
5. Discovery 画面（プール貼付 → ランキング + NGリスト）
6. Comparison / Risk アラート / Dashboard 刷新

**実装順は上記 1→6 の番号順とする**（エンジン先行、UI 後行）。

### Phase 2 — 拡張
- Cloudflare KV への移行（複数端末同期）
- 定期再分析（Cron Triggers → スコア急落検知の自動化）
- Helius 無料枠アダプタ（`HELIUS_API_KEY` があれば精度向上、なければ RPC 継続）
- GMGN 公式/準公式 API が出た場合のアダプタ

### Phase 3 — 知能化
- トレーダークラスタリング（成分スコアベクトルの k-means、k=5 を分類の教師なし検証に使用）
- ポートフォリオ最適化（複数コピー時の資金配分: スコア比例 × リスクスコア逆数）
- 自動コピー連携（GMGN 側の自動化 API が存在しないため、当面は「推奨設定の提示」まで）

---

## 8. 受け入れ基準（実装完了の定義）

1. `avgHoldingHours=792(33日), winRate=56, dailyTrades=0.8, unrealizedPnl≈0, monthlyPnl=[+,+,-]` の入力で **grade B / SWING_STABLE / COPY_OK または CONDITIONAL** になること（現行コピー中トレーダーの再現テスト）
2. `avgHoldingHours=4, winRate=91` で **G1+G4 落ち・NG・理由2件表示**
3. 全指標 null + 手動値なし → **INSUFFICIENT_DATA**（スコア 0 と混同しない）
4. RPC 全滅時も手動入力のみで Validation が完走する
5. 既存の評価履歴・取引記録機能が無変更で動作する
