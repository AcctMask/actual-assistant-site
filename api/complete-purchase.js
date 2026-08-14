const WORKFORCE_ROLES = new Set([
  "administrative-assistant",
  "sales-assistant",
  "marketing-assistant",
  "operations-manager",
  "business-development-assistant",
  "weather-analyst",
  "business-intelligence-manager",
]);

function clean(value) {
  return String(value || "").trim();
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type",
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  const stripeSecretKey =
    process.env.STRIPE_SECRET_KEY;

  const bridgeSecret =
    process.env.AA_PURCHASE_BRIDGE_SECRET;

  if (!stripeSecretKey) {
    return res.status(500).json({
      ok: false,
      error: "Missing STRIPE_SECRET_KEY",
    });
  }

  if (!bridgeSecret) {
    return res.status(500).json({
      ok: false,
      error: "Missing AA_PURCHASE_BRIDGE_SECRET",
    });
  }

  let body = req.body;

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const sessionId =
    clean(body?.session_id);

  if (!sessionId) {
    return res.status(400).json({
      ok: false,
      error: "session_id is required",
    });
  }

  const expand = new URLSearchParams();

  expand.append("expand[]", "customer");
  expand.append("expand[]", "subscription");

  const stripeResponse = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(
      sessionId,
    )}?${expand.toString()}`,
    {
      headers: {
        Authorization:
          `Bearer ${stripeSecretKey}`,
      },
    },
  );

  const session =
    await stripeResponse.json();

  if (!stripeResponse.ok) {
    return res.status(400).json({
      ok: false,
      error:
        session?.error?.message ||
        "Stripe Checkout Session could not be retrieved.",
    });
  }

  if (
    session.status !== "complete" ||
    session.payment_status !== "paid"
  ) {
    return res.status(409).json({
      ok: false,
      error:
        `Checkout is not complete and paid. status=${session.status}, payment_status=${session.payment_status}`,
    });
  }

  const moduleId =
    clean(session?.metadata?.module_id);

  const moduleName =
    clean(session?.metadata?.module_name);

  if (!WORKFORCE_ROLES.has(moduleId)) {
    return res.status(409).json({
      ok: false,
      error:
        `Unsupported workforce role in verified Stripe session: ${moduleId}`,
    });
  }

  if (!moduleName) {
    return res.status(409).json({
      ok: false,
      error:
        "Verified Stripe session is missing module_name metadata.",
    });
  }

  const details =
    session.customer_details || {};

  const customer =
    session.customer &&
    typeof session.customer === "object"
      ? session.customer
      : null;

  const email =
    clean(
      details.email ||
      customer?.email ||
      session.customer_email,
    ).toLowerCase();

  const customerName =
    clean(
      details.name ||
      customer?.name,
    );

  const businessName =
    clean(details.business_name);

  if (!email) {
    return res.status(409).json({
      ok: false,
      error:
        "Verified Stripe session does not contain buyer email.",
    });
  }

  const stripeCustomerId =
    typeof session.customer === "string"
      ? session.customer
      : clean(customer?.id);

  const stripeSubscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : clean(session.subscription?.id);

  const ownerControlsResponse =
    await fetch(
      "https://actual-assistant-owner-controls.vercel.app/api/purchases/complete",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          "x-aa-purchase-bridge-secret":
            bridgeSecret,
        },
        body: JSON.stringify({
          session_id: session.id,
          module_id: moduleId,
          module_name: moduleName,
          email,
          customer_name:
            customerName,
          business_name:
            businessName,
          stripe_customer_id:
            stripeCustomerId,
          stripe_subscription_id:
            stripeSubscriptionId,
          payment_status:
            session.payment_status,
          amount_total:
            session.amount_total,
          currency:
            session.currency,
        }),
      },
    );

  const ownerControlsResult =
    await ownerControlsResponse.json();

  if (
    !ownerControlsResponse.ok ||
    ownerControlsResult.ok !== true
  ) {
    return res.status(502).json({
      ok: false,
      error:
        ownerControlsResult.error ||
        "Owner Controls purchase intake failed.",
      details:
        ownerControlsResult.details ||
        null,
    });
  }

  return res.status(200).json({
    ok: true,
    stripe: {
      session_id: session.id,
      customer_id:
        stripeCustomerId,
      subscription_id:
        stripeSubscriptionId,
      module_id: moduleId,
      module_name: moduleName,
      email,
      customer_name:
        customerName,
      payment_status:
        session.payment_status,
    },
    owner_controls:
      ownerControlsResult,
  });
};
