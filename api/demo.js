export default async function handler(req, res) {
  // CORS (optional, but safe)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).send("Method Not Allowed");
  }

  const body = req.body || {};

  // Required fields
  const company = (body.company || "").toString().trim();
  const name = (body.name || "").toString().trim();
  const email = (body.email || "").toString().trim();
  const phone = (body.phone || "").toString().trim();

  if (!company || !name || !email || !phone) {
    return res.status(400).send("Missing required fields: company, name, email, phone");
  }

  // Optional fields
  const address = (body.address || "").toString().trim();
  const service = (body.service || "").toString().trim();
  const crm = (body.crm || "").toString().trim();
  const leadVolume = (body.leadVolume || "").toString().trim();
  const startWith = (body.startWith || "").toString().trim();
  const questions = (body.questions || "").toString().trim();

  // NOTE: You said you want info@actualassitant.com
  // Double-check spelling when you set up email. If the mailbox doesn't exist yet, leads can still be logged.
  const TO_EMAIL = process.env.DEMO_TO_EMAIL || "info@actualassitant.com";

  // For Resend, FROM must be a verified domain/sender in Resend
  // Keep this as a domain-based no-reply once domain is verified.
  const FROM_EMAIL = process.env.DEMO_FROM_EMAIL || "no-reply@actualassistant.com";

  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  // Always log lead server-side so you never lose it
  console.log("Demo request received:", {
    company, name, email, phone, address, service, crm, leadVolume, startWith,
    questionsPreview: questions ? questions.slice(0, 200) : ""
  });

  // If email isn't configured yet, still return success (so form UX is good)
  if (!RESEND_API_KEY) {
    return res.status(200).json({
      ok: true,
      note: "RESEND_API_KEY not set yet. Lead logged to Vercel function logs."
    });
  }

  const subject = `Actual Assistant Demo Request — ${company}`;

  const text =
`New demo request:

Company: ${company}
Name: ${name}
Email: ${email}
Phone: ${phone}
Address: ${address}

Primary service: ${service}
CRM: ${crm}
Monthly lead volume: ${leadVolume}
Wants to start with: ${startWith}

Questions / goals:
${questions}
`;

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [TO_EMAIL],
        subject,
        text,
        reply_to: email
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Resend error:", errText);
      return res.status(500).send("Email send failed");
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).send("Server error");
  }
}

