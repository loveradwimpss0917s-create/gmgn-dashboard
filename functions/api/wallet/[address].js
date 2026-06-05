export async function onRequest({ params, request }) {
  const addr = params.address;

  // Try multiple GMGN endpoints in order
  const endpoints = [
    `https://gmgn.ai/defi/quotation/v1/smartmoney/sol/walletNew/${addr}?period=30d`,
    `https://gmgn.ai/api/v1/wallet_stat/sol/${addr}?period=30d`,
  ];

  const headers = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    Referer: "https://gmgn.ai/sol/address/" + addr,
    Origin: "https://gmgn.ai",
    "Cache-Control": "no-cache",
  };

  for (const url of endpoints) {
    const res = await fetch(url, { headers });
    if (res.ok) {
      const body = await res.text();
      return new Response(body, {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  }

  return new Response(JSON.stringify({ error: "GMGN API unavailable", code: 403 }), {
    status: 403,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
