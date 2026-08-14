const MODULES = {
  "administrative-assistant": {
    name: "Actual Assistant — Administrative Assistant",
    setupPriceId: "price_1Tpp8gCYgC6lPmKT5tZ8lRoH",
    monthlyPriceId: "price_1TppBXCYgC6lPmKThfqYIvLG",
  },
  "sales-assistant": {
    name: "Actual Assistant — Sales Assistant",
    setupPriceId: "price_1TppDuCYgC6lPmKT34vyvY5a",
    monthlyPriceId: "price_1TppESCYgC6lPmKTMyMCvz53",
  },
  "marketing-assistant": {
    name: "Actual Assistant — Marketing Assistant",
    setupPriceId: "price_1TppHfCYgC6lPmKTV7EFzFgK",
    monthlyPriceId: "price_1TppJqCYgC6lPmKTC6VNIm5U",
  },
  "operations-manager": {
    name: "Actual Assistant — Operations Manager",
    setupPriceId: "price_1TppLECYgC6lPmKTGXp4zJqM",
    monthlyPriceId: "price_1TppN9CYgC6lPmKTo32yCxyz",
  },
  "business-development-assistant": {
    name: "Actual Assistant — Business Development Assistant",
    setupPriceId: "price_1TppOMCYgC6lPmKTWZQ0hCNt",
    monthlyPriceId: "price_1TppPoCYgC6lPmKTGzW3nYUh",
  },
  "weather-analyst": {
    name: "Actual Assistant — Weather Analyst",
    setupPriceId: "price_1TppTtCYgC6lPmKTtxLEsYVb",
    monthlyPriceId: "price_1TppVBCYgC6lPmKTVccELRGW",
  },
  "business-intelligence-manager": {
    name: "Actual Assistant — Business Intelligence Manager",
    setupPriceId: "price_1TppYwCYgC6lPmKTayJ6q28T",
    monthlyPriceId: "price_1TppaMCYgC6lPmKTEfClzMA4",
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
  params.append("success_url", `${origin}/purchase-success.html?module_id=${encodeURIComponent(moduleId)}&session_id={CHECKOUT_SESSION_ID}`);
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
