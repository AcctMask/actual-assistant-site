const {
  MarketplaceMeteringClient,
  ResolveCustomerCommand,
} = require("@aws-sdk/client-marketplace-metering");

const {
  MarketplaceEntitlementServiceClient,
  GetEntitlementsCommand,
} = require("@aws-sdk/client-marketplace-entitlement-service");

const OWNER_CONTROLS_URL =
  "https://actual-assistant-owner-controls.vercel.app/api/commercial-agreements/complete";

const COOKIE_NAME = "aa_aws_marketplace_token";

function clean(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseBody(req) {
  if (!req.body) return {};

  if (typeof req.body === "object") {
    return req.body;
  }

  const raw = String(req.body || "");
  const contentType = String(
    req.headers["content-type"] || "",
  ).toLowerCase();

  if (
    contentType.includes(
      "application/x-www-form-urlencoded",
    )
  ) {
    return Object.fromEntries(
      new URLSearchParams(raw).entries(),
    );
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  const result = {};

  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (!key) continue;

    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }

  return result;
}

function setSecurityHeaders(res) {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
}

function setMarketplaceCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(
      token,
    )}; Path=/api/aws-fulfillment; Max-Age=3600; HttpOnly; Secure; SameSite=Lax`,
  );
}

function clearMarketplaceCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/api/aws-fulfillment; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  );
}

function sendHtml(res, status, html) {
  setSecurityHeaders(res);
  res.statusCode = status;
  res.setHeader(
    "Content-Type",
    "text/html; charset=utf-8",
  );
  return res.end(html);
}

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — Actual Assistant</title>
<style>
  body {
    margin: 0;
    background: #f5f7fb;
    color: #172033;
    font-family: Arial, Helvetica, sans-serif;
  }
  .wrap {
    max-width: 680px;
    margin: 48px auto;
    padding: 0 20px;
  }
  .card {
    background: #fff;
    border: 1px solid #dfe5ee;
    border-radius: 14px;
    padding: 32px;
    box-shadow: 0 8px 24px rgba(20,32,50,.08);
  }
  h1 {
    margin-top: 0;
    font-size: 28px;
  }
  p {
    line-height: 1.55;
  }
  label {
    display: block;
    font-weight: 700;
    margin: 18px 0 6px;
  }
  input {
    box-sizing: border-box;
    width: 100%;
    padding: 12px;
    border: 1px solid #bfc8d5;
    border-radius: 8px;
    font: inherit;
  }
  button {
    margin-top: 24px;
    padding: 13px 20px;
    border: 0;
    border-radius: 8px;
    background: #172033;
    color: white;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
  }
  .muted {
    color: #5d6879;
    font-size: 14px;
  }
</style>
</head>
<body>
<div class="wrap">
<div class="card">
${body}
</div>
</div>
</body>
</html>`;
}

async function resolveMarketplaceCustomer(token) {
  const region = clean(process.env.AWS_REGION);
  const expectedProductCode = clean(
    process.env.AWS_MARKETPLACE_PRODUCT_CODE,
  );

  if (!region) {
    throw new Error("Missing AWS_REGION");
  }

  if (!expectedProductCode) {
    throw new Error(
      "Missing AWS_MARKETPLACE_PRODUCT_CODE",
    );
  }

  const client = new MarketplaceMeteringClient({
    region,
  });

  try {
    const result = await client.send(
      new ResolveCustomerCommand({
        RegistrationToken: token,
      }),
    );

    const customerAwsAccountId = clean(
      result.CustomerAWSAccountId,
    );
    const licenseArn = clean(result.LicenseArn);
    const productCode = clean(result.ProductCode);

    if (!customerAwsAccountId) {
      throw new Error(
        "ResolveCustomer did not return CustomerAWSAccountId",
      );
    }

    if (!licenseArn) {
      throw new Error(
        "ResolveCustomer did not return LicenseArn",
      );
    }

    if (!productCode) {
      throw new Error(
        "ResolveCustomer did not return ProductCode",
      );
    }

    if (productCode !== expectedProductCode) {
      const error = new Error(
        "AWS Marketplace ProductCode does not match Actual Assistant",
      );
      error.code = "PRODUCT_CODE_MISMATCH";
      throw error;
    }

    return {
      customerAwsAccountId,
      licenseArn,
      productCode,
    };
  } finally {
    client.destroy();
  }
}

async function verifyMarketplaceEntitlement(awsIdentity) {
  const client = new MarketplaceEntitlementServiceClient({
    region: "us-east-1",
  });

  try {
    const result = await client.send(
      new GetEntitlementsCommand({
        ProductCode: awsIdentity.productCode,
        Filter: {
          CUSTOMER_AWS_ACCOUNT_ID: [
            awsIdentity.customerAwsAccountId,
          ],
        },
        MaxResults: 25,
      }),
    );

    const entitlements = Array.isArray(
      result.Entitlements,
    )
      ? result.Entitlements
      : [];

    if (entitlements.length === 0) {
      const error = new Error(
        "AWS Marketplace returned no entitlements for this customer",
      );
      error.code = "NO_MARKETPLACE_ENTITLEMENT";
      throw error;
    }

    return entitlements;
  } finally {
    client.destroy();
  }
}

function registrationPage() {
  return page(
    "Complete your registration",
    `
<h1>Welcome to Actual Assistant</h1>

<p>
Your AWS Marketplace subscription has been verified.
Complete the information below so Actual Assistant can
create or connect your business workspace.
</p>

<form method="post" action="/api/aws-fulfillment">
  <input type="hidden" name="aa_action" value="register">

  <label for="business_name">Business name</label>
  <input
    id="business_name"
    name="business_name"
    type="text"
    autocomplete="organization"
    required
  >

  <label for="customer_name">Your name</label>
  <input
    id="customer_name"
    name="customer_name"
    type="text"
    autocomplete="name"
    required
  >

  <label for="email">Business email</label>
  <input
    id="email"
    name="email"
    type="email"
    autocomplete="email"
    required
  >

  <button type="submit">Continue to Actual Assistant</button>
</form>

<p class="muted">
Your AWS Marketplace agreement remains the authority
for this purchase. Actual Assistant will use this
information only to establish your business workspace
and onboarding.
</p>
`,
  );
}

function successPage() {
  return page(
    "Registration received",
    `
<h1>You're registered with Actual Assistant</h1>

<p>
Your AWS Marketplace agreement has been connected to
Actual Assistant.
</p>

<p>
We have started the existing Actual Assistant onboarding
process for your business. Watch your email for your
Company DNA invitation and next steps.
</p>

<p class="muted">
Support: support@actualassistance.com
</p>
`,
  );
}

function errorPage(message) {
  return page(
    "Registration could not be completed",
    `
<h1>We couldn't complete your registration</h1>

<p>${escapeHtml(message)}</p>

<p>
If you recently subscribed through AWS Marketplace,
please return to your AWS Marketplace subscription and
choose the option to configure or set up your account
again.
</p>

<p class="muted">
Support: support@actualassistance.com
</p>
`,
  );
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    return sendHtml(
      res,
      200,
      page(
        "AWS Marketplace registration",
        `
<h1>Actual Assistant — AWS Marketplace</h1>
<p>
This is the secure registration endpoint for customers
who purchase Actual Assistant through AWS Marketplace.
</p>
<p>
Complete your subscription from AWS Marketplace to begin.
</p>
<p class="muted">
Support: support@actualassistance.com
</p>
`,
      ),
    );
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendHtml(
      res,
      405,
      errorPage("Method not allowed."),
    );
  }

  const bridgeSecret = clean(
    process.env.AA_COMMERCIAL_BRIDGE_SECRET,
  );

  if (!bridgeSecret) {
    console.error(
      "AWS fulfillment missing AA_COMMERCIAL_BRIDGE_SECRET",
    );
    return sendHtml(
      res,
      500,
      errorPage(
        "Actual Assistant registration is temporarily unavailable.",
      ),
    );
  }

  const body = parseBody(req);
  const action = clean(body.aa_action);

  let registrationToken = clean(
    body["x-amzn-marketplace-token"],
  );

  if (!registrationToken) {
    const cookies = parseCookies(req);
    registrationToken = clean(
      cookies[COOKIE_NAME],
    );
  }

  if (!registrationToken) {
    return sendHtml(
      res,
      400,
      errorPage(
        "AWS Marketplace registration token is missing.",
      ),
    );
  }

  let awsIdentity;

  try {
    awsIdentity =
      await resolveMarketplaceCustomer(
        registrationToken,
      );
  } catch (error) {
    console.error(
      "AWS ResolveCustomer failed",
      {
        name: error?.name || null,
        code: error?.code || null,
        status:
          error?.$metadata?.httpStatusCode ||
          null,
      },
    );

    return sendHtml(
      res,
      400,
      errorPage(
        "AWS Marketplace could not verify this subscription.",
      ),
    );
  }

  try {
    await verifyMarketplaceEntitlement(
      awsIdentity,
    );
  } catch (error) {
    console.error(
      "AWS GetEntitlements failed",
      {
        name: error?.name || null,
        code: error?.code || null,
        status:
          error?.$metadata?.httpStatusCode ||
          null,
      },
    );

    return sendHtml(
      res,
      400,
      errorPage(
        "AWS Marketplace could not verify this subscription entitlement.",
      ),
    );
  }

  if (action !== "register") {
    setMarketplaceCookie(
      res,
      registrationToken,
    );

    return sendHtml(
      res,
      200,
      registrationPage(),
    );
  }

  const email = clean(body.email).toLowerCase();
  const customerName = clean(
    body.customer_name,
  );
  const businessName = clean(
    body.business_name,
  );

  if (
    !email ||
    !customerName ||
    !businessName
  ) {
    setMarketplaceCookie(
      res,
      registrationToken,
    );

    return sendHtml(
      res,
      400,
      errorPage(
        "Business name, your name, and business email are required.",
      ),
    );
  }

  let ownerControlsResponse;
  let ownerControlsResult;

  try {
    ownerControlsResponse = await fetch(
      OWNER_CONTROLS_URL,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          "x-aa-commercial-bridge-secret":
            bridgeSecret,
        },
        body: JSON.stringify({
          provider: "aws_marketplace",
          product_key: "ai_workforce",
          provider_customer_id:
            awsIdentity.customerAwsAccountId,
          provider_agreement_id:
            awsIdentity.licenseArn,
          provider_product_id:
            awsIdentity.productCode,
          email,
          customer_name: customerName,
          business_name: businessName,
        }),
      },
    );

    const text =
      await ownerControlsResponse.text();

    try {
      ownerControlsResult =
        JSON.parse(text);
    } catch {
      ownerControlsResult = {
        raw: text,
      };
    }
  } catch (error) {
    console.error(
      "Owner Controls commercial bridge request failed",
      {
        message:
          error?.message || String(error),
      },
    );

    return sendHtml(
      res,
      502,
      errorPage(
        "Actual Assistant onboarding could not be started. Your AWS Marketplace agreement has not been lost.",
      ),
    );
  }

  if (
    !ownerControlsResponse.ok ||
    ownerControlsResult?.ok !== true
  ) {
    console.error(
      "Owner Controls commercial bridge rejected AWS agreement",
      {
        status:
          ownerControlsResponse.status,
        error:
          ownerControlsResult?.error ||
          null,
      },
    );

    return sendHtml(
      res,
      502,
      errorPage(
        "Actual Assistant onboarding could not be completed. Your AWS Marketplace agreement has not been lost.",
      ),
    );
  }

  clearMarketplaceCookie(res);

  return sendHtml(
    res,
    200,
    successPage(),
  );
};