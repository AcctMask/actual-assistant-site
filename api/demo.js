import crypto from "crypto";

/**
 * Simple anti-spam guards (in-memory).
 * NOTE: In Vercel serverless, memory is per-instance and may reset.
 * This is still very effective against basic spam bursts.
 *
 * If you want durable throttling across all instances, we can move this to Upstash/Redis.
 */

// Per-instance stores
const LAST_SEEN = new Map();      // key -> timestamp ms
const DAILY_COUNT = new Map();    // key -> { dayKey, count }
const RECENT_HASH = new Map();    // key -> { hash, ts }

function nowMs() { return Date.now(); }
function dayKeyUTC(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
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
  // stable-ish stringify: sort keys at top level
  const keys = Object.keys(obj).sort();
  const ordered = {};
  for (const k of keys) ordered[k] = obj[k];
  return JSON.stringify(ordered);
}

function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function bumpDaily(key, maxPerDay) {
  const dk = dayKeyUTC();
  const cur = DAILY_COUNT.get(key);
  if (!cur || cur.dayKey !== dk) {
    DAILY_COUNT.set(key, { dayKey: dk, count: 1 });
    return { ok: true, count: 1 };
  }
  cur.count += 1;
  DAILY_COUNT.set(key, cur);
  if (cur.count > maxPerDay) return { ok: false, count: cur.count };
  return { ok: true, count: cur.count };
}

function checkMinGap(key, minGapMs) {
  const last = LAST_SEEN.get(key);
  if (last && nowMs() - last < minGapMs) {
    return { ok: false, waitMs: minGapMs - (nowMs() - last) };
  }
  LAST_SEEN.set(key, nowMs());
  return { ok: true };
}

function checkDuplicate(key, hash, duplicateWindowMs) {
  const prev = RECENT_HASH.get(key);
  if (prev && prev.hash === hash && nowMs() - prev.ts < duplicateWindowMs) {
    return { ok: false };
  }
  RECENT_HASH.set(key, { hash, ts: nowMs() });
  return { ok: true };
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

  // Anti-spam controls (tweak here)
  const MIN_GAP_MINUTES = Number(process.env.DEMO_MIN_GAP_MINUTES || 10); // per email + per IP
  const DAILY_CAP = Number(process.env.DEMO_DAILY_CAP || 3);             // per email + per IP
  const DUP_WINDOW_MINUTES = Number(process.env.DEMO_DUP_WINDOW_MINUTES || 60); // same payload within window

  const minGapMs = Math.max(0, MIN_GAP_MINUTES) * 60 * 1000;
  const dupWindowMs = Math.max(1, DUP_WINDOW_MINUTES) * 60 * 1000;

  const sendEmail = async ({ to, subject, text, reply_to }) => {
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
        text,
        ...(reply_to ? { reply_to } : {}),
      }),
    });

    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      const msg = json?.message || json?.error || "Resend send failed";
      const detail = JSON.stringify(json);
      throw new Error(`${msg} :: ${detail}`);
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

    // ---------- Anti-spam guards ----------
    const ip = getClientIp(req);
    const emailKey = normalizeEmail(email) || "noemail";

    const throttleKeys = {
      email: `email:${emailKey}`,
      ip: `ip:${ip}`,
    };

    // Fingerprint the submission to prevent duplicates
    const fpPayload = {
      name,
      company,
      email: emailKey,
      phone,
      state,
      crm,
      cities,
      challenge,
      source,
      page,
    };
    const fpHash = sha256(stableStringify(fpPayload));

    // Duplicate guard (per email + per IP)
    for (const k of Object.values(throttleKeys)) {
      const dupOk = checkDuplicate(k, fpHash, dupWindowMs);
      if (!dupOk.ok) {
        return res.status(429).json({
          ok: false,
          error: "Duplicate submission detected. Please wait before submitting again.",
        });
      }
    }

    // Minimum gap guard (per email + per IP)
    for (const k of Object.values(throttleKeys)) {
      const gapOk = checkMinGap(k, minGapMs);
      if (!gapOk.ok) {
        const waitMin = Math.ceil(gapOk.waitMs / 60000);
        return res.status(429).json({
          ok: false,
          error: `Please wait ${waitMin} minute(s) before submitting again.`,
        });
      }
    }

    // Daily cap guard (per email + per IP)
    for (const k of Object.values(throttleKeys)) {
      const capOk = bumpDaily(k, DAILY_CAP);
      if (!capOk.ok) {
        return res.status(429).json({
          ok: false,
          error: "Daily request limit reached. Please try again tomorrow.",
        });
      }
    }
    // ---------- End anti-spam guards ----------

    // 1) Internal notification
    const internalSubject = `Demo Request — ${company} (${state})`;

    const internalText =
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
IP: ${ip}
Fingerprint: ${fpHash}
`;

    // 2) Customer confirmation
    const customerSubject = `We received your demo request — Actual Assistance`;

    const customerText =
`Hi ${name},

Thanks for requesting a demo of Actual Assistance.

An Actual Assistant representative will be in contact with you shortly to confirm your service area, CRM, and the fastest path to getting results.

If anything changes before we reach out, just reply to this email.

— Actual Assistance
`;

    const internalResult = await sendEmail({
      to: TO_EMAIL,
      subject: internalSubject,
      text: internalText,
      reply_to: email,
    });

    const customerResult = await sendEmail({
      to: email,
      subject: customerSubject,
      text: customerText,
      reply_to: TO_EMAIL,
    });

    return res.status(200).json({
      ok: true,
      internal_id: internalResult?.id || null,
      customer_id: customerResult?.id || null,
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Server error",
      details: String(e?.message || e),
    });
  }
}
