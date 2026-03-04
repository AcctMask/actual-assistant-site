// api/leads.js
// Actual Assistant - Internal CRM leads reader
// Protected endpoint: requires header x-admin-token that matches ADMIN_TOKEN
//
// Env required on Vercel (Production):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ADMIN_TOKEN

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing required env var: ${name}`);
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return json(res, 405, { ok: false, error: "Method Not Allowed" });
    }

    requireEnv("SUPABASE_URL", SUPABASE_URL);
    requireEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);
    requireEnv("ADMIN_TOKEN", ADMIN_TOKEN);

    const token = (req.headers["x-admin-token"] || "").toString().trim();
    if (!token || token !== ADMIN_TOKEN) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }

    const limit = Math.min(parseInt(req.query.limit || "50", 10) || 50, 200);
    const status = (req.query.status || "").toString().trim(); // optional filter

    const base = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/demo_requests`;
    const params = new URLSearchParams();
    params.set("select", "*");
    params.set("order", "created_at.desc");
    params.set("limit", String(limit));
    if (status) params.set("status", `eq.${status}`);

    const resp = await fetch(`${base}?${params.toString()}`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!resp.ok) {
      const msg =
        data?.message || data?.hint || data?.error || text || "Fetch failed";
      return json(res, 500, { ok: false, error: msg });
    }

    return json(res, 200, { ok: true, items: data });
  } catch (err) {
    console.error("api/leads error:", err);
    return json(res, 500, { ok: false, error: err.message || "Server error" });
  }
};
