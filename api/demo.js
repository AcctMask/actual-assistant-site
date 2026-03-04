// api/demo.js
// Vercel Serverless Function: POST /api/demo
// Sends:
// 1) Internal lead email to DEMO_TO_EMAIL
// 2) Customer confirmation email to the submitted email
//
// Uses Resend (RESEND_API_KEY). Includes fallback "from" if your domain isn't verified yet,
// so you still get deliveries while DNS/DKIM settles.

import { Resend } from "resend";

function esc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj?.[k];
  return out;
}

function normalizeEmail(v) {
  const s = String(v || "").trim();
  return s.toLowerCase();
}

function isEmail(v) {
  const s = normalizeEmail(v);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function safeId() {
  // crypto.randomUUID exists in Vercel runtimes
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function buildInternalHtml(payload, internal_id, customer_id) {
  const rows = [
    ["Company", payload.company],
    ["Contact name", payload.name],
    ["Email", payload.email],
    ["Phone", payload.phone],
    ["Website", payload.website || ""],
    ["Primary state", payload.state],
    ["CRM", payload.crm],
    ["Primary cities / markets", payload.cities],
    ["Biggest challenge", payload.challenge || ""],
    ["Notes", payload.notes || ""],
    ["Internal ID", internal_id],
    ["Customer ID", customer_id],
    ["Submitted at (UTC)", new Date().toISOString()],
    ["User agent", payload._ua || ""],
    ["IP (if available)", payload._ip || ""],
  ];

  return `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height:1.4;">
    <h2 style="margin:0 0 12px 0;">New Demo Request — Actual Assistance</h2>
    <p style="margin:0 0 12px 0;">A contractor requested a demo. Details below:</p>
    <table cellpadding="8" cellspacing="0" border="0" style="border-collapse:collapse; width:100%; max-width:820px;">
      ${rows
        .map(
          ([k, v]) => `
        <tr>
          <td style="border:1px solid #e5e7eb; background:#f9fafb; width:220px;"><strong>${esc(
            k
          )}</strong></td>
          <td style="border:1px solid #e5e7eb;">${esc(v || "")}</td>
        </tr>`
        )
        .join("")}
    </table>

    <p style="margin:14px 0 0 0; color:#6b7280; font-size:12px;">
      Reply directly to this email to contact the lead (Reply-To is set to the lead’s email).
    </p>
  </div>`;
}

function buildCustomerHtml(payload) {
  return `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height:1.5;">
    <h2 style="margin:0 0 10px 0;">We received your demo request — Actual Assistance</h2>
    <p style="margin:0 0 12px 0;">
      Hi ${esc(payload.name || "there")},<br/>
      Thanks for requesting a demo of <strong>Actual Assistance</strong>.
    </p>

    <p style="margin:0 0 12px 0;">
      An Actual Assistance representative will be in contact with you shortly to confirm your service area, CRM, and the fastest path to getting results.
    </p>

    <p style="margin:0 0 12px 0;">
      If anything changes before we reach out, just reply to this email.
    </p>

    <p style="margin:0; color:#6b7280; font-size:12px;">
      — Actual Assistance
    </p>
  </div>`;
}

async function sendWithFallback(resend, message, preferredFrom) {
  const fallbackFrom = "Actual Assistance <onboarding@resend.dev>";
  const attempts = [];

  // Attempt 1: preferred from (your domain)
  try {
    const r1 = await resend.emails.send({ ...message, from: preferredFrom });
    attempts.push({ from: preferredFrom, ok: true, id: r1?.id || null });
    return { ok: true, attempts };
  } catch (e1) {
    attempts.push({
      from: preferredFrom,
      ok: false,
      error: e1?.message || String(e1),
    });
  }

  // Attempt 2: fallback from (always works for delivery testing)
  try {
    const r2 = await resend.emails.send({ ...message, from: fallbackFrom });
    attempts.push({ from: fallbackFrom, ok: true, id: r2?.id || null });
    return { ok: true, attempts, usedFallback: true };
  } catch (e2) {
    attempts.push({
      from: fallbackFrom,
      ok: false,
      error: e2?.message || String(e2),
    });
    return { ok: false, attempts };
  }
}

export default async function handler(req, res) {
  // Basic CORS (safe even if not needed)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return json(res, 200, { ok: true });
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Use POST" });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const DEMO_TO_EMAIL = process.env.DEMO_TO_EMAIL || "support@actualassistance.com";
  const DEMO_FROM_EMAIL =
    process.env.DEMO_FROM_EMAIL || "no-reply@actualassistance.com";

  if (!RESEND_API_KEY) {
    console.error("Missing RESEND_API_KEY");
    return json(res, 500, { ok: false, error: "Server not configured (RESEND_API_KEY missing)" });
  }

  let body = req.body;

  // Vercel sometimes gives req.body as a string:
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return json(res, 400, { ok: false, error: "Invalid JSON body" });
    }
  }

  const payload = {
    ...pick(body, [
      "company",
      "name",
      "email",
      "phone",
      "state",
      "crm",
      "cities",
      "challenge",
      "website",
      "notes",
    ]),
  };

  payload.email = normalizeEmail(payload.email);

  // Minimal validation (matches your form)
  const missing = [];
  if (!payload.company) missing.push("company");
  if (!payload.name) missing.push("name");
  if (!payload.email) missing.push("email");
  if (!payload.phone) missing.push("phone");
  if (!payload.state) missing.push("state");
  if (!payload.crm) missing.push("crm");
  if (!payload.cities) missing.push("cities");

  if (missing.length) {
    return json(res, 400, { ok: false, error: `Missing required: ${missing.join(", ")}` });
  }
  if (!isEmail(payload.email)) {
    return json(res, 400, { ok: false, error: "Invalid email" });
  }

  // Add request context
  payload._ua = req.headers["user-agent"] || "";
  payload._ip =
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "";

  const internal_id = safeId();
  const customer_id = safeId();

  const resend = new Resend(RESEND_API_KEY);

  // Internal notification (to you)
  const internalMsg = {
    to: DEMO_TO_EMAIL,
    subject: `Demo request: ${payload.company} (${payload.state}) — ${payload.name}`,
    html: buildInternalHtml(payload, internal_id, customer_id),
    reply_to: payload.email,
  };

  // Customer confirmation
  const customerMsg = {
    to: payload.email,
    subject: "We received your demo request — Actual Assistance",
    html: buildCustomerHtml(payload),
    reply_to: "support@actualassistance.com",
  };

  // Send both, with fallback "from" if your domain isn't verified yet.
  const internalSend = await sendWithFallback(resend, internalMsg, `Actual Assistance <${DEMO_FROM_EMAIL}>`);
  const customerSend = await sendWithFallback(resend, customerMsg, `Actual Assistance <${DEMO_FROM_EMAIL}>`);

  // If either failed, return 500 so you SEE it in Vercel Logs.
  if (!internalSend.ok || !customerSend.ok) {
    console.error("Email send failure", {
      internalSend,
      customerSend,
      DEMO_TO_EMAIL,
      DEMO_FROM_EMAIL,
    });

    return json(res, 500, {
      ok: false,
      error: "Email send failed (see attempts)",
      internal_id,
      customer_id,
      internalSend,
      customerSend,
    });
  }

  // Success
  return json(res, 200, {
    ok: true,
    internal_id,
    customer_id,
    internalSend,
    customerSend,
  });
}
