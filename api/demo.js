/**
 * Vercel Serverless Function: /api/demo
 * - Sends 2 emails via Resend REST API:
 *   (1) internal notification to DEMO_TO_EMAIL
 *   (2) confirmation to the customer (their submitted email)
 *
 * Env vars (Vercel):
 * - RESEND_API_KEY
 * - DEMO_TO_EMAIL        (e.g. support@actualassistance.com)
 * - DEMO_FROM_EMAIL      (e.g. no-reply@actualassistance.com)
 * Optional:
 * - DEMO_BCC_EMAIL       (e.g. your personal Gmail for early-stage deliverability safety)
 */

function safeStr(v) {
  return (typeof v === "string" ? v.trim() : "");
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendResendEmail({ apiKey, from, to, subject, html, replyTo, bcc }) {
  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };

  if (replyTo) payload.reply_to = replyTo;
  if (bcc) payload.bcc = Array.isArray(bcc) ? bcc : [bcc];

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // leave json null; text will be returned
  }

  if (!resp.ok) {
    const err = new Error(`Resend error (${resp.status})`);
    err.status = resp.status;
    err.bodyText = text;
    err.bodyJson = json;
    throw err;
  }

  // Successful response typically: { id: "..." }
  return json || { raw: text };
}

module.exports = async (req, res) => {
  // Basic CORS (safe for a public demo form)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.DEMO_TO_EMAIL;
  const fromEmail = process.env.DEMO_FROM_EMAIL;
  const bccEmail = process.env.DEMO_BCC_EMAIL; // optional safety

  if (!apiKey || !toEmail || !fromEmail) {
    return res.status(500).json({
      ok: false,
      error: "Missing server configuration",
      missing: {
        RESEND_API_KEY: !apiKey,
        DEMO_TO_EMAIL: !toEmail,
        DEMO_FROM_EMAIL: !fromEmail,
      },
    });
  }

  // Parse body
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  // Required fields
  const company = safeStr(body.company);
  const name = safeStr(body.name);
  const email = safeStr(body.email);
  const phone = safeStr(body.phone);
  const state = safeStr(body.state);
  const crm = safeStr(body.crm);
  const cities = safeStr(body.cities);

  // Optional fields
  const website = safeStr(body.website);
  const challenge = safeStr(body.challenge);
  const notes = safeStr(body.notes);

  const missing = [];
  if (!company) missing.push("company");
  if (!name) missing.push("name");
  if (!email) missing.push("email");
  if (!phone) missing.push("phone");
  if (!state) missing.push("state");
  if (!crm) missing.push("crm");
  if (!cities) missing.push("cities");

  if (missing.length) {
    return res.status(400).json({
      ok: false,
      error: "Missing required fields",
      missing,
    });
  }

  // Email content
  const now = new Date().toISOString();

  const internalSubject = `New demo request: ${company} (${state})`;
  const internalHtml = `
    <div style="font-family:Arial, sans-serif; line-height:1.4;">
      <h2 style="margin:0 0 8px 0;">New Demo Request</h2>
      <p style="margin:0 0 12px 0;color:#444;">Received: ${escapeHtml(now)}</p>

      <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse; font-size:14px;">
        <tr><td><b>Company</b></td><td>${escapeHtml(company)}</td></tr>
        <tr><td><b>Contact</b></td><td>${escapeHtml(name)}</td></tr>
        <tr><td><b>Email</b></td><td>${escapeHtml(email)}</td></tr>
        <tr><td><b>Phone</b></td><td>${escapeHtml(phone)}</td></tr>
        <tr><td><b>Primary State</b></td><td>${escapeHtml(state)}</td></tr>
        <tr><td><b>Primary Cities/Markets</b></td><td>${escapeHtml(cities)}</td></tr>
        <tr><td><b>CRM</b></td><td>${escapeHtml(crm)}</td></tr>
        <tr><td><b>Website</b></td><td>${website ? `<a href="${escapeHtml(website)}">${escapeHtml(website)}</a>` : "(none)"}</td></tr>
        <tr><td><b>Biggest Challenge</b></td><td>${escapeHtml(challenge || "(none)")}</td></tr>
        <tr><td><b>Notes</b></td><td>${escapeHtml(notes || "(none)")}</td></tr>
      </table>

      <p style="margin-top:14px;color:#444;">
        Reply-to is set to ${escapeHtml(toEmail)}.
      </p>
    </div>
  `;

  const customerSubject = "We received your demo request — Actual Assistance";
  const customerHtml = `
    <div style="font-family:Arial, sans-serif; line-height:1.5;">
      <p>Hi ${escapeHtml(name)},</p>
      <p>Thanks for requesting a demo of <b>Actual Assistance</b>.</p>
      <p>
        An Actual Assistance representative will be in contact with you shortly to confirm your service area, CRM,
        and the fastest path to getting results.
      </p>

      <h3 style="margin:18px 0 6px 0;">Your request</h3>
      <ul>
        <li><b>Company:</b> ${escapeHtml(company)}</li>
        <li><b>State:</b> ${escapeHtml(state)}</li>
        <li><b>Markets:</b> ${escapeHtml(cities)}</li>
        <li><b>CRM:</b> ${escapeHtml(crm)}</li>
        ${website ? `<li><b>Website:</b> ${escapeHtml(website)}</li>` : ""}
      </ul>

      <p style="margin-top:16px;">
        If anything changes before we reach out, just reply to this email.
      </p>

      <p style="color:#666; margin-top:18px;">— Actual Assistance</p>
    </div>
  `;

  // Send emails
  try {
    // Internal notification
    const internal = await sendResendEmail({
      apiKey,
      from: `Actual Assistance <${fromEmail}>`,
      to: toEmail,
      subject: internalSubject,
      html: internalHtml,
      replyTo: toEmail,
      bcc: bccEmail || undefined,
    });

    // Customer confirmation
    const customer = await sendResendEmail({
      apiKey,
      from: `Actual Assistance <${fromEmail}>`,
      to: email,
      subject: customerSubject,
      html: customerHtml,
      replyTo: toEmail,
      bcc: bccEmail || undefined,
    });

    // Helpful server log
    console.log("demo email sent", {
      internal_id: internal?.id,
      customer_id: customer?.id,
      toEmail,
      fromEmail,
      customerEmail: email,
    });

    return res.status(200).json({
      ok: true,
      internal_email_id: internal?.id || null,
      customer_email_id: customer?.id || null,
    });
  } catch (err) {
    console.error("demo email failed", {
      message: err?.message,
      status: err?.status,
      bodyText: err?.bodyText,
      bodyJson: err?.bodyJson,
    });

    return res.status(500).json({
      ok: false,
      error: "Email send failed",
      message: err?.message || "Unknown error",
      status: err?.status || null,
      resend: err?.bodyJson || null,
    });
  }
};
