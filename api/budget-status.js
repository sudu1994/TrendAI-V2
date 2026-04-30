/**
 * api/budget-status.js — Internal admin endpoint
 * Returns company-wide spend summary. Protect with internal auth in production.
 */
const { handleOptions, ok, err } = require('./lib/helpers');
const { getBudgetSummary } = require('./lib/budget');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;

  // Basic internal auth — replace with your SSO / JWT check
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET) {
    return err(res, 403, 'Forbidden');
  }

  return ok(res, getBudgetSummary());
};
