#!/usr/bin/env node
import fs from "fs";
import path from "path";

function arg(name, def = "") {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const city = arg("city");
const state = arg("state");
const date = arg("date");
const event = arg("event", "Verified Weather Event");
const zips = arg("zips", "");

if (!city || !state || !date) {
  console.error(`Missing required args.
Required: --city "City" --state "ST" --date "YYYY-MM-DD"
Optional: --event "Severe Wind" --zips "12345,12346"`);
  process.exit(1);
}

const slug = `${slugify(city)}-${slugify(state)}-${slugify(date)}`;
const dir = path.join(process.cwd(), "storm", slug);
fs.mkdirSync(dir, { recursive: true });

const title = `Storm Response Demo — ${city}, ${state} (${date}) | Actual Assistant™`;
const desc = `Verified storm activity near ${city}, ${state} on ${date}. See how Actual Assistant turns storm events into contractor leads with automated storm marketing + targeting.`;
const canonical = `https://actualassistant-site.vercel.app/storm/${slug}/`;

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />

  <title>${title}</title>
  <meta name="description" content="${desc}" />
  <link rel="canonical" href="${canonical}" />

  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:type" content="website" />

  <style>
    :root{--bg:#061224;--card:rgba(255,255,255,.06);--border:rgba(255,255,255,.12);--text:rgba(255,255,255,.92);--muted:rgba(255,255,255,.72);--btn:#2b7cff;--shadow:0 24px 80px rgba(0,0,0,.45);--r:18px}
    *{box-sizing:border-box}
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:var(--text);
      background:radial-gradient(1100px 700px at 20% 10%, rgba(43,124,255,.25), transparent 60%),
               radial-gradient(900px 600px at 75% 30%, rgba(16,185,129,.14), transparent 60%),
               linear-gradient(180deg,#061224,#02060f 60%);
      min-height:100vh;
    }
    a{color:inherit}
    .wrap{max-width:980px;margin:0 auto;padding:26px 18px 64px}
    .hero{border:1px solid var(--border);background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.04));
      border-radius:var(--r);padding:22px;box-shadow:var(--shadow)}
    h1{margin:0 0 8px;font-size:34px;letter-spacing:-.6px}
    .sub{margin:0 0 14px;color:var(--muted);line-height:1.55}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
    @media(max-width:860px){.grid{grid-template-columns:1fr} h1{font-size:28px}}
    .card{border:1px solid var(--border);background:var(--card);border-radius:var(--r);padding:16px}
    .btn{display:inline-flex;align-items:center;gap:8px;text-decoration:none;background:var(--btn);padding:12px 14px;border-radius:12px;font-weight:800}
    .muted{color:var(--muted)}
    ul{margin:10px 0 0;padding-left:18px;color:var(--muted);line-height:1.6}
    code{background:rgba(255,255,255,.08);padding:2px 6px;border-radius:8px}
  </style>
</head>

<body>
  <div class="wrap">
    <a href="/storm/">← Back to storm pages</a>

    <div class="hero">
      <h1>Storm Response Demo — ${city}, ${state}</h1>
      <p class="sub">
        <strong>Event:</strong> ${event}<br/>
        <strong>Date:</strong> ${date}<br/>
        ${zips ? `<strong>Target ZIPs:</strong> <code>${zips}</code>` : ""}
      </p>

      <div class="grid">
        <div class="card">
          <h2>Why this matters</h2>
          <ul>
            <li>Homeowners start searching immediately after storms.</li>
            <li>Speed wins: early visibility captures the first calls.</li>
            <li>Most contractors react days later — too late.</li>
          </ul>
        </div>

        <div class="card">
          <h2>What Actual Assistant automates</h2>
          <ul>
            <li>Storm-triggered posts (with anti-spam safeguards)</li>
            <li>Local messaging to impacted areas</li>
            <li>Traffic to estimator to capture leads</li>
            <li>CRM-agnostic routing foundation</li>
          </ul>
        </div>
      </div>

      <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
        <a class="btn" href="/activate-storm-response.html">Activate Storm Response Demo</a>
        <a class="btn" style="background:rgba(255,255,255,.10);border:1px solid var(--border)" href="/">View Platform Menu</a>
      </div>

      <p class="muted" style="margin-top:12px;font-size:12px">
        Internal outreach asset. Not a direct sale page.
      </p>
    </div>
  </div>
</body>
</html>
`;

fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
console.log(`✅ Created: storm/${slug}/index.html`);
console.log(`URL after deploy: ${canonical}`);
