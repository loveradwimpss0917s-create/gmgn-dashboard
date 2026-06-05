const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export async function onRequest({ params }) {
  const addr = params.address;

  // Step 1: get session cookies from GMGN
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

  // Step 2: fetch wallet stats
  const apiUrl = `https://gmgn.ai/defi/quotation/v1/smartmoney/sol/walletNew/${addr}?period=30d`;
  const res = await fetch(apiUrl, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
      "User-Agent": UA,
      Referer: `https://gmgn.ai/sol/address/${addr}`,
      Origin: "https://gmgn.ai",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });

  const body = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
    // Attach top-level keys for debugging field names
    const d = parsed?.data || parsed;
    parsed._keys = Object.keys(d);
  } catch (_) {}

  return new Response(JSON.stringify(parsed ?? body), {
    status: res.status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
