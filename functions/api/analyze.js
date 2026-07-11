// POST /api/analyze — 複数アドレスの一括統計（DESIGN.md §4.3）
// 公開RPC保護のため直列 + 200ms 間隔で実行する

import {
  getWalletStats,
  jsonResponse,
  isSolanaAddress,
} from "./_walletStats.js";

const MAX_ADDRESSES = 20;

export async function onRequestPost({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body", code: "INVALID_ADDRESS" }, 400);
  }
  const addresses = body?.addresses;
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return jsonResponse({ error: "addresses[] required", code: "INVALID_ADDRESS" }, 400);
  }
  if (addresses.length > MAX_ADDRESSES) {
    return jsonResponse({ error: `max ${MAX_ADDRESSES} addresses`, code: "INVALID_ADDRESS" }, 400);
  }

  const results = [];
  const errors = [];
  for (const addr of addresses) {
    if (!isSolanaAddress(addr)) {
      errors.push({ address: addr, error: "invalid address format" });
      continue;
    }
    try {
      const { data } = await getWalletStats(addr);
      results.push({ address: addr, ...data });
    } catch (e) {
      errors.push({ address: addr, error: String(e.message ?? e) });
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  return jsonResponse({ results, errors });
}
