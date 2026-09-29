/**
 * Vercel Serverless Function: /api/demo
 * - Sends 2 emails via Resend REST API:
 *   (1) internal notification to DEMO_TO_EMAIL
 *   (2) confirmation to the customer (their submitted email)
 *
 * Env vars (Vercel):
 * - RESEND_API_KEY
 * - DEMO_TO_EMAIL        (e.g. actualassistant.ai@gmail.com)
 * - DEMO_FROM_EMAIL      (e.g. no-reply@actualassistance.com)
 * Optional:
 * - DEMO_BCC_EMAIL       (e.g. your personal Gmail for early-stage deliverability safety)
 */

function safeStr(v) {
  return (typeof v === "string" ? v.trim() : "");
}

const ALLOWED_CRM_VALUES = new Set([
  "None",
  "JobNimbus",
  "AccuLynx",
  "CompanyCam",
  "HubSpot",
  "Salesforce",
  "Other",
]);

function looksLikeHumanText(value, { min = 2, max = 120 } = {}) {
  const text = safeStr(value);

  if (text.length < min || text.length > max) return false;

  // Keep this deliberately conservative. Bot protection should come from
  // request integrity, honeypot, timing, and structured field validation;
  // legitimate names and company acronyms must not be rejected as gibberish.
  if (!/[A-Za-z]/.test(text)) return false;

  return true;
}

function validEmail(value) {
  const email = safeStr(value);
  if (email.length > 254) return false;

  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
}

function validPhone(value) {
  const phone = safeStr(value);
  const digits = phone.replace(/\\D/g, "");

  return digits.length >= 10 && digits.length <= 15;
}

function requestIsFromActualAssistance(req) {
  const allowedHosts = new Set([
    "actualassistance.com",
    "www.actualassistance.com",
  ]);

  for (const header of ["origin", "referer"]) {
    const raw = safeStr(req.headers?.[header]);
    if (!raw) continue;

    try {
      const hostname = new URL(raw).hostname.toLowerCase();
      if (allowedHosts.has(hostname)) return true;
    } catch {
      return false;
    }
  }

  return false;
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function saveProspectToSupabase(prospect) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn("Skipping prospect save: missing Supabase env vars");
    return null;
  }

  const resp = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/aa_prospects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(prospect),
  });

  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!resp.ok) {
    console.error("Prospect save failed", json);
    return null;
  }

  return Array.isArray(json) ? json[0] : json;
}

async function createNavigatorDemoRequest({
  company,
  name,
  email,
  phone,
  state,
  cities,
  crm,
  website,
  challenge,
  notes,
}) {
  const navigatorBaseUrl = (
    process.env.NAVIGATOR_API_BASE_URL ||
    "https://contractor-navigator.onrender.com"
  ).replace(/\/$/, "");

  const gatewaySecret =
    process.env.AA_ACTIVITY_GATEWAY_SECRET;

  if (!gatewaySecret) {
    console.error(
      "Navigator demo request skipped: " +
      "missing AA_ACTIVITY_GATEWAY_SECRET",
    );

    return {
      ok: false,
      skipped: true,
      reason:
        "missing_aa_activity_gateway_secret",
    };
  }

  const navigatorNotes = [
    `Company: ${company}`,
    `Contact: ${name}`,
    `Primary State: ${state}`,
    `Primary Cities/Markets: ${cities}`,
    `CRM: ${crm}`,
    website
      ? `Website: ${website}`
      : null,
    challenge
      ? `Biggest Challenge: ${challenge}`
      : null,
    notes
      ? `Additional Notes: ${notes}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(
    `${navigatorBaseUrl}` +
      `/business-development/` +
      `actual-assistant-llc/intake`,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        "x-aa-activity-secret":
          gatewaySecret,
      },

      body: JSON.stringify({
        source:
          "manual_office_entry",

        source_detail:
          "Website Demo Request",

        customer_name:
          company
            ? `${company} — ${name}`
            : name,

        customer_phone:
          phone || null,

        customer_email:
          email || null,

        state:
          state || null,

        notes:
          navigatorNotes,

        external_reference:
          `website-demo-${Date.now()}`,
      }),
    },
  );

  const responseText =
    await response.text();

  let responseBody = null;

  try {
    responseBody =
      JSON.parse(responseText);
  } catch {
    responseBody = {
      raw: responseText,
    };
  }

  if (!response.ok) {
    console.error(
      "Navigator demo lead creation failed",
      {
        status: response.status,
        response: responseBody,
      },
    );

    return {
      ok: false,
      status: response.status,
      response: responseBody,
    };
  }

  return {
    ok: true,
    status: response.status,

    action:
      responseBody?.action || null,

    job_id:
      responseBody?.job_id || null,
  };
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
  const toEmail = process.env.DEMO_TO_EMAIL || "actualassistant.ai@gmail.com";
  const fromEmail = process.env.DEMO_FROM_EMAIL;
  const bccEmail = process.env.DEMO_BCC_EMAIL; // optional safety
  const internalToEmails = Array.from(new Set([toEmail, "actualassistant.ai@gmail.com"].filter(Boolean)));

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

  // ------------------------------------------------------------------
  // Public demo ingress protection.
  //
  // IMPORTANT:
  // This gate runs before Supabase, Navigator, or Resend side effects.
  // Rejected traffic must not create prospects/jobs or send email.
  // ------------------------------------------------------------------

  const honeypot = safeStr(body.company_website_confirm);
  const formStartedAt = Number(body.form_started_at || 0);
  const formAgeMs =
    Number.isFinite(formStartedAt) && formStartedAt > 0
      ? Date.now() - formStartedAt
      : 0;

  if (honeypot) {
    console.warn("Rejected demo submission: honeypot");
    return res.status(400).json({
      ok: false,
      error: "Invalid submission",
    });
  }

  if (!requestIsFromActualAssistance(req)) {
    console.warn("Rejected demo submission: origin");
    return res.status(403).json({
      ok: false,
      error: "Invalid submission origin",
    });
  }

  // A real person cannot reasonably complete this form in under 3 seconds.
  // Reject missing, future, stale (>2 hours), or implausibly fast timestamps.
  if (
    !formStartedAt ||
    formAgeMs < 3000 ||
    formAgeMs > 2 * 60 * 60 * 1000
  ) {
    console.warn("Rejected demo submission: timing");
    return res.status(400).json({
      ok: false,
      error: "Invalid submission",
    });
  }

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
  const smsConsent =
    safeStr(body.sms_consent).toLowerCase() === "yes";

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

  const invalid = [];

  if (!looksLikeHumanText(company, { min: 2, max: 120 })) {
    invalid.push("company");
  }

  if (!looksLikeHumanText(name, { min: 2, max: 120 })) {
    invalid.push("name");
  }

  if (!validEmail(email)) {
    invalid.push("email");
  }

  if (!validPhone(phone)) {
    invalid.push("phone");
  }

  if (!looksLikeHumanText(state, { min: 2, max: 80 })) {
    invalid.push("state");
  }

  if (!looksLikeHumanText(cities, { min: 2, max: 200 })) {
    invalid.push("cities");
  }

  if (!ALLOWED_CRM_VALUES.has(crm)) {
    invalid.push("crm");
  }

  if (website && website.length > 300) {
    invalid.push("website");
  }

  if (challenge.length > 2000) {
    invalid.push("challenge");
  }

  if (notes.length > 4000) {
    invalid.push("notes");
  }

  if (invalid.length) {
    console.warn("Rejected demo submission: validation", {
      invalid,
    });

    return res.status(400).json({
      ok: false,
      error: "Invalid submission",
      invalid,
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
        <tr><td><b>SMS Consent</b></td><td>${smsConsent ? "YES" : "NO"}</td></tr>
      </table>

      <p style="margin-top:14px;color:#444;">
        Reply-to is set to ${escapeHtml(email)}.
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
    const savedProspect = await saveProspectToSupabase({
      company_name: company,
      contact_name: name,
      email,
      phone,
      website,
      state,
      cities,
      crm,
      source: "website_demo",
      interested_modules: ["AI Follow-Up & After-Hours Assistant", "Automated Socials", "Instant Roof Estimator"],
      status: "New Demo Request",
      notes: [
        challenge,
        notes,
        `SMS Consent: ${smsConsent ? "YES" : "NO"}`
      ].filter(Boolean).join("\n\n"),
    });

    const navigatorDemo =
      await createNavigatorDemoRequest({
        company,
        name,
        email,
        phone,
        state,
        cities,
        crm,
        website,
        challenge,
        notes: [
          notes,
          `SMS Consent: ${smsConsent ? "YES" : "NO"}`
        ].filter(Boolean).join("\n\n"),
      }).catch((error) => {
        console.error(
          "Navigator demo request creation error",
          {
            message:
              error?.message ||
              String(error),
          },
        );

        return {
          ok: false,
          error:
            error?.message ||
            String(error),
        };
      });

    // Internal notification
    const internal = await sendResendEmail({
      apiKey,
      from: `Actual Assistance <${fromEmail}>`,
      to: internalToEmails,
      subject: internalSubject,
      html: internalHtml,
      replyTo: email,
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
      prospect_id: savedProspect?.id || null,
      navigator_job_id:
        navigatorDemo?.job_id || null,
      navigator_created:
        navigatorDemo?.ok === true,
      toEmail,
      fromEmail,
      customerEmail: email,
    });

    const acceptsHtml = String(req.headers.accept || "").includes("text/html");
    if (acceptsHtml) {
      res.statusCode = 303;
      res.setHeader("Location", "/demo-thank-you.html");
      return res.end();
    }

    return res.status(200).json({
      ok: true,
      prospect_id: savedProspect?.id || null,
      navigator_job_id:
        navigatorDemo?.job_id || null,
      navigator_created:
        navigatorDemo?.ok === true,
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
