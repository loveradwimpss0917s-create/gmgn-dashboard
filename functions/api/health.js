// GET /api/health — RPC 疎通確認

import { jsonResponse } from "./_walletStats.js";

export async function onRequestGet() {
  try {
    const r = await fetch("https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
    });
    const j = await r.json();
    return jsonResponse({ ok: j.result === "ok", rpc: j.result ?? j.error?.message });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e.message ?? e) }, 502);
  }
}
