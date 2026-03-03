import crypto from "crypto";

const LAST_SEEN = new Map();
const DAILY_COUNT = new Map();
const RECENT_HASH = new Map();

function nowMs() { return Date.now(); }
function dayKeyUTC(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
function getClientIp(req) {
  const xfwd = req.headers["x-forwarded-for"];
  if (typeof xfwd === "string" && xfwd.length) {
    return xfwd.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}
function normalizeEmail(s) {
  return String(s || "").trim().toLowerCase();
}
function stableStringify(obj) {
  const keys = Object.keys(obj).sort();
  const ordered = {};
  for (const k of keys) ordered[k] = obj[k];
  return JSON.stringify(ordered);
}
function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const TO_EMAIL = process.env.DEMO_TO_EMAIL || "support@actualassistance.com";
  const FROM_EMAIL = process.env.DEMO_FROM_EMAIL || "no-reply@actualassistance.com";

  if (!RESEND_API_KEY) {
    return res.status(500).json({ ok: false, error: "Missing RESEND_API_KEY" });
  }

  const sendEmail = async ({ to, subject, html, reply_to }) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Actual Assistance <${FROM_EMAIL}>`,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        ...(reply_to ? { reply_to } : {}),
      }),
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(json?.message || "Resend send failed");
    }
    return json;
  };

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const name = String(body?.name ?? "").trim();
    const company = String(body?.company ?? "").trim();
    const email = String(body?.email ?? "").trim();
    const phone = String(body?.phone ?? "").trim();
    const state = String(body?.state ?? "").trim();
    const crm = String(body?.crm ?? "").trim();
    const cities = String(body?.cities ?? "").trim();
    const challenge = String(body?.challenge ?? "").trim();

    const required = { name, company, email, phone, state, crm, cities, challenge };
    const missing = Object.entries(required)
      .filter(([_, v]) => !v)
      .map(([k]) => k);

    if (missing.length) {
      return res.status(400).json({ ok: false, error: `Missing fields: ${missing.join(", ")}` });
    }

    const ip = getClientIp(req);

    // INTERNAL EMAIL
    const internalHtml = `
      <h2 style="margin-bottom:8px;">🚨 New Demo Request</h2>
      <hr />
      <h3>Lead Details</h3>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Company:</strong> ${company}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone}</p>
      <p><strong>State:</strong> ${state}</p>
      <p><strong>CRM:</strong> ${crm}</p>
      <p><strong>Target Cities:</strong> ${cities}</p>
      <p><strong>Biggest Challenge:</strong></p>
      <p>${challenge}</p>
      <hr />
      <p><small>IP: ${ip}</small></p>
    `;

    await sendEmail({
      to: TO_EMAIL,
      subject: `🚨 Demo Request — ${company} (${state})`,
      html: internalHtml,
      reply_to: email,
    });

    // CUSTOMER CONFIRMATION
    const customerHtml = `
      <p>Hi ${name},</p>
      <p>Thanks for requesting a demo of <strong>Actual Assistance</strong>.</p>
      <p>An Actual Assistant representative will be in contact with you shortly to confirm your service area, CRM, and the fastest path to getting results.</p>
      <p>If anything changes before we reach out, just reply to this email.</p>
      <br/>
      <p>— Actual Assistance</p>
    `;

    await sendEmail({
      to: email,
      subject: `We received your demo request — Actual Assistance`,
      html: customerHtml,
      reply_to: TO_EMAIL,
    });

    return res.status(200).json({ ok: true });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Server error",
      details: String(e?.message || e),
    });
  }
}
