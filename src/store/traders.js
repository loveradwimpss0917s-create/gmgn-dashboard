// 永続化ストア（DESIGN.md §6.3）— localStorage、既存キーとは併存

import { load, save } from "../ui.js";
import { STRATEGY_LABELS } from "../engine/classify.js";

const K_TRADERS = "gmgn.traders.v1";
const K_POOL = "gmgn.pool.v1";
const K_RULES = "gmgn.rules.v1";
const K_ALERTS = "gmgn.alerts.v1";

const DEFAULT_RULES = { buySOL: 0.3, slPct: -60, tpPct: null, devSellPct: 25, autoSellPct: 100 };

export const loadTraders = () => load(K_TRADERS, {});
export const loadPool = () => load(K_POOL, []);
export const loadRules = () => ({ ...DEFAULT_RULES, ...load(K_RULES, {}) });
export const loadAlerts = () => load(K_ALERTS, []);

export const savePool = (pool) => save(K_POOL, pool);
export const saveRules = (rules) => save(K_RULES, rules);
export const saveAlerts = (alerts) => save(K_ALERTS, alerts);

const NG_TYPES = ["SCALPING", "GAMBLER"];

/**
 * トレーダーを保存し、前回結果と比較してアラートを生成する（§5.5）。
 * @returns {{traders, alerts: 新規アラート[]}}
 */
export function saveTrader(stats, verdict) {
  const traders = loadTraders();
  const prev = traders[stats.address];
  const newAlerts = [];

  if (prev?.verdict) {
    const p = prev.verdict;
    if (
      p.score?.totalScore != null && verdict.score?.totalScore != null &&
      p.score.totalScore - verdict.score.totalScore >= 15
    ) {
      newAlerts.push({
        type: "SCORE_DROP",
        msg: `📉 ${label(stats)} のスコアが ${p.score.totalScore}→${verdict.score.totalScore} に急落`,
      });
    }
    if (
      p.strategyType === "SWING_STABLE" &&
      NG_TYPES.includes(verdict.strategyType)
    ) {
      newAlerts.push({
        type: "STRATEGY_SHIFT",
        msg: `🚨 ${label(stats)} が ${STRATEGY_LABELS[verdict.strategyType]} に戦略変化`,
      });
    }
    if (p.gate?.passed && !verdict.gate.passed) {
      newAlerts.push({
        type: "NEW_GATE_FAIL",
        msg: `🚫 ${label(stats)} が除外条件に該当（NG化）: ${verdict.gate.failures[0]?.reasonJa ?? ""}`,
      });
    }
  }

  const history = [verdict, ...(prev?.history ?? [])].slice(0, 20);
  traders[stats.address] = { stats, verdict, history };
  save(K_TRADERS, traders);

  if (newAlerts.length > 0) {
    const stamped = newAlerts.map((a) => ({
      ...a,
      id: Date.now() + Math.random(),
      address: stats.address,
      date: new Date().toISOString(),
    }));
    saveAlerts([...stamped, ...loadAlerts()].slice(0, 50));
  }
  return { traders, alerts: newAlerts };
}

export function removeTrader(address) {
  const traders = loadTraders();
  delete traders[address];
  save(K_TRADERS, traders);
  return traders;
}

export function dismissAlert(id) {
  const next = loadAlerts().filter((a) => a.id !== id);
  saveAlerts(next);
  return next;
}

const label = (stats) =>
  stats.label || stats.address.slice(0, 6) + "…" + stats.address.slice(-4);
