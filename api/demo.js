// api/demo.js
// Single, clean demo endpoint
// POST /api/demo

module.exports = async (req, res) => {
  // CORS (safe)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const DEMO_FROM_EMAIL = process.env.DEMO_FROM_EMAIL;
  const DEMO_TO_EMAIL = process.env.DEMO_TO_EMAIL;

  if (!RESEND_API_KEY || !DEMO_FROM_EMAIL || !DEMO_TO_EMAIL) {
    return res.status(500).json({
      error: "Missing server configuration",
      missing: {
        RESEND_API_KEY: !RESEND_API_KEY,
        DEMO_FROM_EMAIL: !DEMO_FROM_EMAIL,
        DEMO_TO_EMAIL: !DEMO_TO_EMAIL,
      },
    });
  }

  let body = req.body;
  try {
    if (typeof body === "string") body = JSON.parse(body);
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const payload = body || {};

  const company = String(payload.company || "").trim();
  const name = String(payload.name || "").trim();
  const email = String(payload.email || "").trim();
  const phone = String(payload.phone || "").trim();
  const primaryService = String(payload.primaryService || "").trim();
  const crm = String(payload.crm || "").trim();
  const leadVolume = String(payload.leadVolume || "").trim();
  const message = String(payload.message || "").trim();

  if (!company || !name || !email) {
    return res.status(400).json({
      error: "Missing required fields",
      required: ["company", "name", "email"],
    });
  }

  const subject = `Demo Request — ${company} (${name})`;

  const text = [
    "New demo request received:",
    "",
    `Company: ${company}`,
    `Name: ${name}`,
    `Email: ${email}`,
    phone ? `Phone: ${phone}` : null,
    primaryService ? `Primary service: ${primaryService}` : null,
    crm ? `CRM: ${crm}` : null,
    leadVolume ? `Monthly lead volume: ${leadVolume}` : null,
    message ? `Message: ${message}` : null,
    "",
    `Submitted at: ${new Date().toISOString()}`
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: DEMO_FROM_EMAIL,
        to: [DEMO_TO_EMAIL],
        reply_to: email,
        subject,
        text,
      }),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      return res.status(500).json({
        error: "Resend send failed",
        status: resp.status,
        details: data,
      });
    }

    return res.status(200).json({ ok: true, id: data.id || null });

  } catch (err) {
    return res.status(500).json({
      error: "Server error sending email",
      message: err?.message || String(err),
    });
  }
};
