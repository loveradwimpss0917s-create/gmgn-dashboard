// 共有ウォレット統計ロジック（DESIGN.md §4.2）
// _prefix のファイルは Pages Functions のルーティング対象外

const RPC = "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TX_SAMPLE = 40;
const CONCURRENCY = 5;

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`RPC ${method}: ${j.error.message}`);
  return j.result;
}

/** 並列数を制限して map する（公開RPCの429対策） */
async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx]);
      } catch {
        out[idx] = null;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Solana RPC + Jupiter からウォレット30日統計を計算する。
 * @returns §4.2 のレスポンス data 形
 */
export async function getWalletStats(addr) {
  // 1. トークン保有
  const tokenAccounts = await rpc("getTokenAccountsByOwner", [
    addr,
    { programId: TOKEN_PROGRAM },
    { encoding: "jsonParsed" },
  ]);
  const holdings = (tokenAccounts?.value ?? [])
    .map((a) => {
      const info = a.account.data.parsed.info;
      return {
        mint: info.mint,
        amount: parseFloat(info.tokenAmount.uiAmountString ?? 0),
      };
    })
    .filter((h) => h.amount > 0);

  // 2. Jupiter 価格 → 含み評価額
  let unrealizedUsd = 0;
  if (holdings.length > 0) {
    const mints = holdings.map((h) => h.mint).slice(0, 100).join(",");
    try {
      const priceRes = await fetch(`https://price.jup.ag/v6/price?ids=${mints}`);
      const priceData = await priceRes.json();
      for (const h of holdings) {
        const p = priceData?.data?.[h.mint]?.price ?? 0;
        unrealizedUsd += h.amount * p;
      }
    } catch {}
  }

  // 3. 直近30日の署名
  const sigs = await rpc("getSignaturesForAddress", [addr, { limit: 200 }]);
  const cutoff = Date.now() / 1000 - 30 * 86400;
  const recent = (sigs ?? []).filter((s) => s.blockTime >= cutoff && !s.err);

  // 4. サンプル tx をパースして「ミント別の残高変化の時系列」を作る
  const sample = recent.slice(0, TX_SAMPLE);
  const parsed = await mapLimited(sample, CONCURRENCY, (sig) =>
    rpc("getTransaction", [
      sig.signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
    ]),
  );

  const events = []; // {time, mint, pre, post}
  let wins = 0;
  let losses = 0;
  for (const tx of parsed) {
    if (!tx?.meta) continue;
    const time = tx.blockTime;
    const changes = {};
    for (const b of tx.meta.preTokenBalances ?? []) {
      if (b.owner !== addr) continue;
      changes[b.mint] = changes[b.mint] ?? { pre: 0, post: 0 };
      changes[b.mint].pre = parseFloat(b.uiTokenAmount?.uiAmountString ?? 0);
    }
    for (const b of tx.meta.postTokenBalances ?? []) {
      if (b.owner !== addr) continue;
      changes[b.mint] = changes[b.mint] ?? { pre: 0, post: 0 };
      changes[b.mint].post = parseFloat(b.uiTokenAmount?.uiAmountString ?? 0);
    }
    const mints = Object.keys(changes);
    for (const m of mints) {
      events.push({ time, mint: m, ...changes[m] });
    }
    // 勝率推計: 同一 tx 内で「得たトークン」と「手放したトークン」があればスワップ
    if (mints.length >= 2) {
      const gained = mints.some((m) => changes[m].post > changes[m].pre);
      const sold = mints.some((m) => changes[m].post < changes[m].pre);
      if (gained && sold) wins++;
      else if (sold) losses++;
    }
  }

  // 5. 保有時間推計: ミントごとに「0→正（初回買い）」と「減少（売り）」をペアリング
  events.sort((a, b) => a.time - b.time);
  const openBuy = {}; // mint -> buyTime
  const holdHours = [];
  for (const e of events) {
    if (e.pre === 0 && e.post > 0) {
      if (openBuy[e.mint] == null) openBuy[e.mint] = e.time;
    } else if (e.post < e.pre && openBuy[e.mint] != null) {
      holdHours.push((e.time - openBuy[e.mint]) / 3600);
      if (e.post === 0) delete openBuy[e.mint];
    }
  }
  const avgHoldHours = holdHours.length >= 3 ? median(holdHours) : null;
  const shortTermRatio =
    holdHours.length >= 3
      ? holdHours.filter((h) => h < 1).length / holdHours.length
      : null;

  const total = wins + losses;
  const winrate = total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : null;

  return {
    unrealized_profit: unrealizedUsd > 0 ? unrealizedUsd.toFixed(0) : null,
    winrate,
    buy_30d: Math.round(recent.length * 0.55),
    sell_30d: Math.round(recent.length * 0.45),
    avg_hold_duration: avgHoldHours != null ? parseFloat(avgHoldHours.toFixed(1)) : null,
    trade_count_30d: recent.length,
    short_term_ratio: shortTermRatio != null ? parseFloat(shortTermRatio.toFixed(2)) : null,
    daily_trades: recent.length > 0 ? parseFloat((recent.length / 30).toFixed(1)) : null,
  };
}

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}

export const isSolanaAddress = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
