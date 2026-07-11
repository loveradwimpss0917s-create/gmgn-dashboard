// 数値ユーティリティ（React非依存・純粋関数）

/** アンカー点 [[x,y],...]（x昇順）に対する区分線形補間 */
export function piecewiseLinear(anchors, x) {
  if (x <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i - 1];
    const [x2, y2] = anchors[i];
    if (x <= x2) return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
  }
  return anchors[anchors.length - 1][1];
}

export const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;

export const stddev = (a) => {
  const m = avg(a);
  return Math.sqrt(avg(a.map((x) => (x - m) ** 2)));
};

/** 変動係数（0–2にクランプ）。平均0は最大の2を返す */
export const cvOf = (a) => {
  const m = avg(a);
  return m === 0 ? 2 : Math.min(stddev(a) / Math.abs(m), 2);
};

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Solanaアドレス形式（base58, 32–44字）の簡易検証 */
export const isSolanaAddress = (s) =>
  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
