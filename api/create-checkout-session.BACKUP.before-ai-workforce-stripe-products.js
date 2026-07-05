const MODULES = {
  "ai-follow-up": {
    name: "AI Follow-Up & After-Hours Assistant",
    setupPriceId: "price_1TY3fICYgC6lPmKTWb2yEyTx",
    monthlyPriceId: "price_1T2ulXCYgC6lPmKTS1b3hvyi",
  },
  "automated-socials": {
    name: "Automated Socials",
    setupPriceId: "price_1TY3vmCYgC6lPmKT68p2Qik9",
    monthlyPriceId: "price_1TY3yzCYgC6lPmKTFpH7E4xq",
  },
  "roof-estimator": {
    name: "Instant Roof Estimator",
    setupPriceId: "price_1TY3l8CYgC6lPmKTBCy5ZGrr",
    monthlyPriceId: "price_1TY3oBCYgC6lPmKTVv1aDD0F",
  },
};

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return res.status(500).json({ ok: false, error: "Missing STRIPE_SECRET_KEY" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const moduleId = body?.module_id;
  const selectedModule = MODULES[moduleId];

  if (!selectedModule) {
    return res.status(400).json({ ok: false, error: "Invalid module_id" });
  }

  const origin =
    process.env.SITE_URL ||
    req.headers.origin ||
    `https://${req.headers.host}`;

  const params = new URLSearchParams();
  params.append("mode", "subscription");
  params.append("success_url", `${origin}/?checkout=success&module_id=${encodeURIComponent(moduleId)}`);
  params.append("cancel_url", `${origin}/?checkout=cancelled&module_id=${encodeURIComponent(moduleId)}`);
  params.append("metadata[module_id]", moduleId);
  params.append("metadata[module_name]", selectedModule.name);

  params.append("line_items[0][price]", selectedModule.monthlyPriceId);
  params.append("line_items[0][quantity]", "1");

  params.append("line_items[1][price]", selectedModule.setupPriceId);
  params.append("line_items[1][quantity]", "1");

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await response.json();

  if (!response.ok) {
    return res.status(500).json({
      ok: false,
      error: data.error?.message || "Stripe checkout failed",
      details: data,
    });
  }

  return res.status(200).json({ ok: true, url: data.url });
};
