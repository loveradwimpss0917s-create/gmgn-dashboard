const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export async function onRequest({ params }) {
  const addr = params.address;

  // Step 1: get session cookies
  let cookie = "";
  try {
    const home = await fetch(`https://gmgn.ai/sol/address/${addr}`, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
    });
    const setCookie = home.headers.get("set-cookie");
    if (setCookie) {
      cookie = setCookie.split(/,(?=[^ ])/).map(c => c.split(";")[0].trim()).join("; ");
    }
  } catch (_) {}

  const headers = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    "User-Agent": UA,
    Referer: `https://gmgn.ai/sol/address/${addr}`,
    Origin: "https://gmgn.ai",
    ...(cookie ? { Cookie: cookie } : {}),
  };

  // Try endpoints in order until one succeeds with valid data
  const endpoints = [
    `https://gmgn.ai/api/v1/wallet_activity/sol/${addr}?period=30d&type=buy,sell`,
    `https://gmgn.ai/defi/quotation/v1/wallet_stat/sol/${addr}?period=30d`,
    `https://gmgn.ai/defi/quotation/v1/pnl/sol/${addr}?period=30d`,
    `https://gmgn.ai/defi/quotation/v1/smartmoney/sol/walletNew/${addr}?period=30d`,
  ];

  let lastBody = null;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers });
      const text = await res.text();
      const json = JSON.parse(text);
      // Accept if code is 0 or missing (success) and data is non-empty
      const d = json?.data;
      if (json.code === 0 || (d && Object.keys(d).length > 0)) {
        json._keys = d ? Object.keys(d) : [];
        json._endpoint = url;
        return new Response(JSON.stringify(json), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
      lastBody = json;
    } catch (_) {}
  }

  // Return last response with debug info
  return new Response(JSON.stringify({ ...lastBody, _debug: "all endpoints failed" }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
