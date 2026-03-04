// api/demo.js
// Vercel Serverless Function (Node 18+)
// Sends 2 emails via Resend REST API using fetch:
// 1) Internal lead notification to DEMO_TO_EMAIL
// 2) Customer confirmation to the lead's email

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function readJsonBody(req) {
  // If Vercel already parsed it (sometimes happens), just return it.
  if (req.body && typeof req.body === "object") return req.body;

  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function resendSend({ apiKey, from, to, subject, text, html, replyTo }) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text,
      html,
      reply_to: replyTo ? [replyTo] : undefined,
    }),
  });

  const contentType = resp.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await resp.json()
    : await resp.text();

  if (!resp.ok) {
    const msg =
      typeof payload === "string"
        ? payload
        : payload?.message || payload?.error || JSON.stringify(payload);
    throw new Error(`Resend error (${resp.status}): ${msg}`);
  }

  return payload; // usually { id: "..." }
}

module.exports = async (req, res) => {
  try {
    // Only allow POST
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return json(res, 405, { ok: false, error: "Method Not Allowed" });
    }

    // Env
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const DEMO_TO_EMAIL = process.env.DEMO_TO_EMAIL || "support@actualassistance.com";
    const DEMO_FROM_EMAIL = process.env.DEMO_FROM_EMAIL || "no-reply@actualassistance.com";

    if (!RESEND_API_KEY) {
      return json(res, 500, {
        ok: false,
        error: "Missing RESEND_API_KEY in Vercel environment variables",
      });
    }

    // Body
    const body = await readJsonBody(req);

    // Required fields (these match your demo.html)
    const company = (body.company || "").trim();
    const name = (body.name || "").trim();
    const email = (body.email || "").trim();
    const phone = (body.phone || "").trim();
    const state = (body.state || "").trim();
    const crm = (body.crm || "").trim();
    const cities = (body.cities || "").trim();

    // Optional
    const website = (body.website || "").trim();
    const challenge = (body.challenge || "").trim();
    const notes = (body.notes || "").trim();

    // Basic validation
    const missing = [];
    if (!company) missing.push("company");
    if (!name) missing.push("name");
    if (!email) missing.push("email");
    if (!phone) missing.push("phone");
    if (!state) missing.push("state");
    if (!crm) missing.push("crm");
    if (!cities) missing.push("cities");

    if (missing.length) {
      return json(res, 400, {
        ok: false,
        error: `Missing required field(s): ${missing.join(", ")}`,
      });
    }

    // Build internal lead email (this is what you want to research before calling)
    const leadText = [
      "New Book-a-Demo request",
      "----------------------",
      `Company: ${company}`,
      `Contact: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone}`,
      `Website: ${website || "(none)"}`,
      `Primary state: ${state}`,
      `Primary cities/markets: ${cities}`,
      `CRM: ${crm}`,
      `Biggest challenge: ${challenge || "(none)"}`,
      `Notes: ${notes || "(none)"}`,
      "",
      "Reply directly to this email to reach the lead.",
    ].join("\n");

    const leadHtml = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height: 1.4;">
        <h2>New Book-a-Demo request</h2>
        <table cellpadding="6" cellspacing="0" border="0" style="border-collapse: collapse;">
          <tr><td><b>Company</b></td><td>${escapeHtml(company)}</td></tr>
          <tr><td><b>Contact</b></td><td>${escapeHtml(name)}</td></tr>
          <tr><td><b>Email</b></td><td>${escapeHtml(email)}</td></tr>
          <tr><td><b>Phone</b></td><td>${escapeHtml(phone)}</td></tr>
          <tr><td><b>Website</b></td><td>${website ? `<a href="${escapeHtml(website)}">${escapeHtml(website)}</a>` : "(none)"}</td></tr>
          <tr><td><b>Primary state</b></td><td>${escapeHtml(state)}</td></tr>
          <tr><td><b>Primary cities/markets</b></td><td>${escapeHtml(cities)}</td></tr>
          <tr><td><b>CRM</b></td><td>${escapeHtml(crm)}</td></tr>
          <tr><td><b>Biggest challenge</b></td><td>${escapeHtml(challenge || "(none)")}</td></tr>
          <tr><td><b>Notes</b></td><td>${escapeHtml(notes || "(none)")}</td></tr>
        </table>
        <p style="margin-top: 14px;">
          <b>Tip:</b> reply to this email to contact the lead directly.
        </p>
      </div>
    `;

    // Customer confirmation email
    const customerSubject = "We received your demo request — Actual Assistance";
    const customerText = [
      `Hi ${name},`,
      "",
      "Thanks for requesting a demo of Actual Assistance.",
      "",
      "An Actual Assistance representative will be in contact with you shortly to confirm your service area, CRM, and the fastest path to getting results.",
      "",
      "If anything changes before we reach out, just reply to this email.",
      "",
      "— Actual Assistance",
    ].join("\n");

    const customerHtml = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height: 1.5;">
        <p>Hi ${escapeHtml(name)},</p>
        <p>Thanks for requesting a demo of <b>Actual Assistance</b>.</p>
        <p><b>An Actual Assistance representative will be in contact with you shortly</b> to confirm your service area, CRM, and the fastest path to getting results.</p>
        <p>If anything changes before we reach out, just reply to this email.</p>
        <p>— Actual Assistance</p>
      </div>
    `;

    // Send internal + customer
    // Internal: send TO your support inbox, reply-to the lead
    const internalResult = await resendSend({
      apiKey: RESEND_API_KEY,
      from: DEMO_FROM_EMAIL,
      to: DEMO_TO_EMAIL,
      subject: `New demo request: ${company} (${state})`,
      text: leadText,
      html: leadHtml,
      replyTo: email,
    });

    // Customer: send to lead email, reply-to support
    const customerResult = await resendSend({
      apiKey: RESEND_API_KEY,
      from: DEMO_FROM_EMAIL,
      to: email,
      subject: customerSubject,
      text: customerText,
      html: customerHtml,
      replyTo: DEMO_TO_EMAIL,
    });

    return json(res, 200, {
      ok: true,
      internal_email_id: internalResult?.id || null,
      customer_email_id: customerResult?.id || null,
    });
  } catch (err) {
    // Always return JSON so jq never breaks again
    return json(res, 500, {
      ok: false,
      error: err?.message || "Server error",
    });
  }
};
