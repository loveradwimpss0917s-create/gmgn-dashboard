import {
  getWalletStats,
  jsonResponse,
  isSolanaAddress,
} from "../_walletStats.js";

export async function onRequest(context) {
  const addr = context.params.address;
  if (!isSolanaAddress(addr)) {
    return jsonResponse({ error: "invalid Solana address", code: "INVALID_ADDRESS" }, 400);
  }

  // 60秒キャッシュ（公開RPCのレート保護）
  const cache = caches.default;
  const cacheKey = new Request(new URL(context.request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const data = await getWalletStats(addr);
    const res = jsonResponse(
      {
        data,
        _source: "solana-rpc",
        _completeness:
          Object.values(data).filter((v) => v != null).length /
          Object.keys(data).length,
        _fetchedAt: new Date().toISOString(),
      },
      200,
      { "Cache-Control": "public, max-age=60" },
    );
    context.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (e) {
    return jsonResponse({ error: String(e.message ?? e), code: "RPC_ERROR" }, 502);
  }
}
