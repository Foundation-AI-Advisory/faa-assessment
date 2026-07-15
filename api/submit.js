/* FAA "Where Do You Stand With AI?" — capture endpoint (spec v2.1 §6)
 * Idempotent Airtable upsert + pain-point update mode + result email.
 * Required Vercel env vars:
 *  AIRTABLE_TOKEN — PAT with data.records:read + write on the base
 *  AIRTABLE_BASE  — appAOghRSDz0zIowL   (FAA AI Assessment)
 *  AIRTABLE_TABLE — tblQe1jJPVfFTFDUN   (Submissions)
 *  RESEND_API_KEY / RESEND_FROM — optional; enables the result email
 */

const AT_API = "https://api.airtable.com/v0";

const Q12_LABELS = {
  A: "A - Clear guidance and boundaries",
  B: "B - Some guidance, unclear boundaries",
  C: "C - Use ahead of rules",
  D: "D - Unknown if guidance exists",
  E: "E - No AI at work"
};
const Q13_LABELS = {
  A: "A - Better individual tasks",
  B: "B - Repeatable personal workflows",
  C: "C - Build tools others use",
  D: "D - Redesign team/business",
  E: "E - Not sure yet"
};
const QP_LABELS = {
  A: "A - Rarely or never",
  B: "B - Occasionally, one-off questions",
  C: "C - Regularly, a few kinds of things",
  D: "D - Woven into life, reusable setups"
};

async function airtable(method, path, body) {
  const res = await fetch(`${AT_API}/${process.env.AIRTABLE_BASE}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`Airtable ${method} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function findByIdem(idem) {
  const formula = encodeURIComponent(`{idempotency_id}="${idem.replace(/"/g, "")}"`);
  const data = await airtable("GET", `${process.env.AIRTABLE_TABLE}?filterByFormula=${formula}&maxRecords=1`);
  return data.records && data.records[0] ? data.records[0].id : null;
}

function fieldsFromPayload(p) {
  const q = p.answers || [];
  return {
    email: p.email,
    submitted_at: p.submitted_at,
    idempotency_id: p.idempotency_id,
    q1_frequency: q[0], q2_breadth: q[1], q3_integration: q[2], q4_iteration: q[3],
    q5_context: q[4], q6_tooling: q[5], q7_building_for_others: q[6],
    q8_tool_selection: q[7], q9_output_handling: q[8], q10_systematization: q[9],
    q11_capability_expansion: q[10],
    answer_labels: (p.answer_labels || []).join("\n"),
    q12_governance: Q12_LABELS[p.q12_governance],
    next_goal: Q13_LABELS[p.next_goal],
    personal_use: QP_LABELS[p.personal_use],
    blocked_potential: !!p.blocked_potential,
    total_score: p.total_score,
    tier_public: p.tier_public,
    builder_signal: !!(p.flags && p.flags.builder_signal),
    connected_automation: !!(p.flags && p.flags.connected_automation),
    team_leverage: !!(p.flags && p.flags.team_leverage),
    high_systematization: !!(p.flags && p.flags.high_systematization),
    governance_opportunity: !!(p.flags && p.flags.governance_opportunity),
    quiz_version: p.quiz_version,
    source: p.source,
    processing_status: "received"
  };
}

async function sendResultEmail(p) {
  if (!process.env.RESEND_API_KEY) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || "Foundation AI Advisory <onboarding@resend.dev>",
      to: p.email,
      subject: `Your AI-adoption profile: ${p.tier_public}`,
      text: `Your AI-adoption profile: ${p.tier_public} (${p.total_score}/33)

This is a directional snapshot based on how you answered today — not a test score.

The four profiles: Observer -> Explorer -> Operator -> Integrator.

Want to talk through what is next? Visit https://foundationaiadvisory.com

Foundation AI Advisory — Business First. AI Applied.`
    })
  });
  return res.ok;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const p = req.body || {};
  if (!p.idempotency_id) return res.status(400).json({ error: "idempotency_id required" });

  try {
    if (p.update === "pain_point") {
      const recId = await findByIdem(p.idempotency_id);
      if (!recId) return res.status(404).json({ error: "record not found for idempotency_id" });
      await airtable("PATCH", process.env.AIRTABLE_TABLE, {
        records: [{ id: recId, fields: {
          pain_point_text: String(p.pain_point_text || "").slice(0, 2000),
          pain_point_provided: true
        } }]
      });
      return res.status(200).json({ ok: true });
    }

    if (!p.email) return res.status(400).json({ error: "email required" });
    const existing = await findByIdem(p.idempotency_id);
    if (existing) {
      return res.status(200).json({ ok: true, duplicate: true, emailSent: null });
    }
    await airtable("POST", process.env.AIRTABLE_TABLE, {
      records: [{ fields: fieldsFromPayload(p) }]
    });

    let emailSent = false;
    try { emailSent = await sendResultEmail(p); }
    catch (e) { console.error("[faa-assessment] email send failed:", e.message); }

    if (!emailSent) console.warn("[faa-assessment] result email not sent for", p.idempotency_id);
    return res.status(200).json({ ok: true, emailSent });
  } catch (e) {
    console.error("[faa-assessment] CAPTURE FAILURE", p.idempotency_id, e.message);
    return res.status(502).json({ ok: false, error: "capture_failed" });
  }
};
