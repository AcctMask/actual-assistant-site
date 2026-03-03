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

    const source = String(body?.source ?? "actualassistant_demo").trim();
    const page = String(body?.page ?? "").trim();
    const ts = String(body?.ts ?? new Date().toISOString()).trim();

    const required = { name, company, email, phone, state, crm, cities, challenge };
    const missing = Object.entries(required)
      .filter(([_, v]) => !v)
      .map(([k]) => k);

    if (missing.length) {
      return res.status(400).json({ ok: false, error: `Missing fields: ${missing.join(", ")}` });
    }

    const subject = `Demo Request — ${company} (${state})`;

    const text =
`New Actual Assistance Demo Request

Name: ${name}
Company: ${company}
Email: ${email}
Phone: ${phone}
State: ${state}
CRM: ${crm}
Cities: ${cities}

Biggest challenge:
${challenge}

Meta:
Source: ${source}
Page: ${page}
Submitted: ${ts}
`;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Actual Assistance <${FROM_EMAIL}>`,
        to: [TO_EMAIL],
        subject,
        text,
        reply_to: email,
      }),
    });

    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: "Resend send failed",
        details: json,
      });
    }

    return res.status(200).json({
      ok: true,
      id: json.id || null,
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Server error",
      details: String(e?.message || e),
    });
  }
}
