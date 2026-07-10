/* FAA "Where Do You Stand With AI?" — scoring module (spec v2.1 final)
 * Pure functions; used by the quiz page and by the test suite.
 * DO NOT modify thresholds, flags, or tier logic without three-party spec approval. */

(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.FAAScoring = factory(); }
}(typeof self !== "undefined" ? self : this, function () {

  const QUIZ_VERSION = "v2.1";
  const TIERS = ["Observer", "Explorer", "Operator", "Integrator"];

  // answers: array of 11 integers (0-3), index 0 = Q1 ... index 10 = Q11
  function computeTotal(answers) {
    if (!Array.isArray(answers) || answers.length !== 11) {
      throw new Error("Expected 11 scored answers");
    }
    return answers.reduce(function (sum, v) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 3) throw new Error("Answer values must be integers 0-3");
      return sum + n;
    }, 0);
  }

  // Straight additive; no gates (spec v2.1 §3)
  function computeTier(total) {
    if (total <= 7) return "Observer";
    if (total <= 16) return "Explorer";
    if (total <= 25) return "Operator";
    return "Integrator";
  }

  // Secondary segmentation flags (spec v2.1 §5). q12 is "A".."E".
  function computeFlags(answers, q12) {
    const q6 = answers[5], q7 = answers[6], q10 = answers[9];
    return {
      builder_signal: q10 === 3 && (q6 >= 2 || q7 === 3),
      connected_automation: q6 === 3,
      team_leverage: q7 === 3,
      high_systematization: q10 === 3,
      governance_opportunity: ["B", "C", "D"].indexOf(q12) !== -1
    };
  }

  function scoreSubmission(answers, q12, q13) {
    const total = computeTotal(answers);
    return {
      total_score: total,
      tier_public: computeTier(total),
      flags: computeFlags(answers, q12),
      q12_governance: q12,
      next_goal: q13,
      quiz_version: QUIZ_VERSION
    };
  }

  return { QUIZ_VERSION: QUIZ_VERSION, TIERS: TIERS, computeTotal: computeTotal, computeTier: computeTier, computeFlags: computeFlags, scoreSubmission: scoreSubmission };
}));
