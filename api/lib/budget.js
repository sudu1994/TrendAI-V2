/**
 * budget.js — Corporate Budget Monitor & Usage Tracker
 * Centralized ¥3,000/month cap for Paid Layer (Claude) calls.
 * Persists to a JSON file per month. In production, swap for DB/Redis.
 */

const fs = require('fs');
const path = require('path');

const BUDGET_CAP_JPY = 3000;
// Claude Haiku: ~$0.25/MTok in, $1.25/MTok out ≈ ¥40–50 per ~4k token call
const COST_PER_CLAUDE_CALL_JPY = 45;
const STORE_PATH = path.join('/tmp', 'ssi_budget.json');

function currentMonth() {
  return new Date().toISOString().slice(0, 7); // "2026-04"
}

function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (data.month !== currentMonth()) return freshStore();
    return data;
  } catch {
    return freshStore();
  }
}

function freshStore() {
  return { month: currentMonth(), totalSpendJpy: 0, calls: [] };
}

function saveStore(data) {
  try { fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2)); } catch {}
}

/**
 * BudgetCheck middleware — call BEFORE any Paid Layer request.
 * Returns { allowed: bool, remainingJpy: number, totalSpendJpy: number }
 */
function checkBudget() {
  const store = loadStore();
  const remaining = BUDGET_CAP_JPY - store.totalSpendJpy;
  if (store.totalSpendJpy >= BUDGET_CAP_JPY) {
    return { allowed: false, remainingJpy: 0, totalSpendJpy: store.totalSpendJpy };
  }
  return { allowed: true, remainingJpy: remaining, totalSpendJpy: store.totalSpendJpy };
}

/**
 * trackUsage — call AFTER a successful Paid Layer response.
 * @param {string} userId - internal user identifier
 * @param {string} feature - "website_generation" | "business_plan"
 * @param {number} [costJpy] - override cost estimate
 */
function trackUsage(userId, feature, costJpy = COST_PER_CLAUDE_CALL_JPY) {
  const store = loadStore();
  store.totalSpendJpy = Math.round((store.totalSpendJpy + costJpy) * 100) / 100;
  store.calls.push({
    ts: new Date().toISOString(),
    userId,
    feature,
    costJpy,
    runningTotalJpy: store.totalSpendJpy,
  });
  saveStore(store);
  return store;
}

function getBudgetSummary() {
  const store = loadStore();
  const pct = Math.min(100, Math.round((store.totalSpendJpy / BUDGET_CAP_JPY) * 100));
  return {
    month: store.month,
    totalSpendJpy: store.totalSpendJpy,
    capJpy: BUDGET_CAP_JPY,
    remainingJpy: Math.max(0, BUDGET_CAP_JPY - store.totalSpendJpy),
    usagePct: pct,
    callCount: store.calls.length,
    byUser: store.calls.reduce((acc, c) => {
      acc[c.userId] = (acc[c.userId] || 0) + c.costJpy;
      return acc;
    }, {}),
  };
}

module.exports = { checkBudget, trackUsage, getBudgetSummary, COST_PER_CLAUDE_CALL_JPY };
