#!/usr/bin/env node

import fs from "fs";
import path from "path";

const SITE = "https://www.actualassistance.com";

function arg(name, def = "") {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const assistants = {
  "administrative-assistant": {
    name: "AI Administrative Assistant",
    url: "/assistants/administrative-assistant.html"
  },
  "sales-assistant": {
    name: "AI Sales Assistant",
    url: "/assistants/sales-assistant.html"
  },
  "marketing-assistant": {
    name: "AI Marketing Assistant",
    url: "/assistants/marketing-assistant.html"
  },
  "operations-manager": {
    name: "AI Operations Manager",
    url: "/assistants/operations-manager.html"
  },
  "business-development-assistant": {
    name: "AI Business Development Assistant",
    url: "/assistants/business-development-assistant.html"
  },
  "weather-analyst": {
    name: "AI Weather Analyst",
    url: "/assistants/weather-analyst.html"
  },
  "business-intelligence-manager": {
    name: "AI Business Intelligence Manager",
    url: "/assistants/business-intelligence-manager.html"
  }
};

const title = arg("title");
const summary = arg("summary");
const body = arg("body");
const assistantKey = arg("assistant", "marketing-assistant");
const source = arg("source", "marketing");
const suppliedSlug = arg("slug");

if (!title || !summary || !body) {
  console.error(`
Missing required arguments.

Required:
  --title "Page title"
  --summary "Search/social description"
  --body "Full page content"

Optional:
  --assistant "marketing-assistant"
  --source "facebook"
  --slug "custom-url-slug"
`);
  process.exit(1);
}

if (!assistants[assistantKey]) {
  console.error(`Unknown assistant: ${assistantKey}`);
  process.exit(1);
}

const assistant = assistants[assistantKey];
const slug = suppliedSlug || slugify(title);

const dir = path.join(process.cwd(), "insights", slug);
const file = path.join(dir, "index.html");

if (fs.existsSync(file)) {
  console.error(`Refusing to overwrite existing page: ${file}`);
  process.exit(1);
}

fs.mkdirSync(dir, { recursive: true });

const canonical = `${SITE}/insights/${slug}/`;
const published = new Date().toISOString();

const workforceLinks = Object.entries(assistants)
  .map(([key, item]) =>
    `<a href="${item.url}">${esc(item.name)}</a>`
  )
  .join(" · ");

const paragraphs = body
  .split(/\n{2,}/)
  .map(p => `<p>${esc(p.trim())}</p>`)
  .join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">

  <title>${esc(title)} | Actual Assistant</title>
  <meta name="description" content="${esc(summary)}">
  <link rel="canonical" href="${canonical}">

  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(summary)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${SITE}/actual-assistant-og.png">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(summary)}">
  <meta name="twitter:image" content="${SITE}/actual-assistant-og.png">

  <script type="application/ld+json">
  ${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": title,
    "description": summary,
    "datePublished": published,
    "dateModified": published,
    "mainEntityOfPage": canonical,
    "publisher": {
      "@type": "Organization",
      "name": "Actual Assistant",
      "url": SITE
    },
    "about": {
      "@type": "Service",
      "name": assistant.name,
      "url": SITE + assistant.url
    }
  }, null, 2)}
  </script>

  <style>
    body{
      margin:0;
      font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;
      background:linear-gradient(180deg,#061224,#02060f);
      color:#fff;
    }
    .wrap{max-width:900px;margin:auto;padding:40px 20px 70px}
    a{color:#93c5fd}
    h1{font-size:44px;line-height:1.08;margin-bottom:18px}
    h2{margin-top:34px}
    p{font-size:18px;line-height:1.75;color:rgba(255,255,255,.88)}
    .meta,.workforce{
      margin-top:28px;
      padding:18px;
      border:1px solid rgba(255,255,255,.12);
      border-radius:16px;
      background:rgba(255,255,255,.04);
    }
    .cta{
      display:inline-block;
      margin-top:20px;
      padding:13px 18px;
      border-radius:12px;
      background:#2b7cff;
      color:#fff;
      text-decoration:none;
      font-weight:800;
    }
  </style>
</head>

<body>
<div class="wrap">

  <p><a href="/">← Actual Assistant</a></p>

  <article>
    <h1>${esc(title)}</h1>

    <p><strong>${esc(summary)}</strong></p>

    ${paragraphs}

    <div class="meta">
      <strong>Related Actual Assistant:</strong><br>
      <a href="${assistant.url}">${esc(assistant.name)}</a>
      <br><br>
      Source: ${esc(source)}
    </div>

    <a class="cta" href="${assistant.url}">
      Learn About ${esc(assistant.name)}
    </a>
  </article>

  <div class="workforce">
    <strong>Explore the Actual Assistant AI Workforce</strong><br><br>
    ${workforceLinks}
  </div>

</div>
</body>
</html>`;

fs.writeFileSync(file, html, "utf8");


// ------------------------------------------------------
// Sitemap update
// ------------------------------------------------------

const sitemapPath = path.join(process.cwd(), "sitemap.xml");
let sitemap = fs.readFileSync(sitemapPath, "utf8");

if (!sitemap.includes(canonical)) {
  const entry = `
  <url>
    <loc>${canonical}</loc>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
`;

  sitemap = sitemap.replace(
    "</urlset>",
    `${entry}</urlset>`
  );

  fs.writeFileSync(sitemapPath, sitemap, "utf8");
}

console.log(`✅ Created permanent SEO page`);
console.log(`Page: insights/${slug}/index.html`);
console.log(`Canonical: ${canonical}`);
console.log(`Primary assistant: ${assistant.name}`);
console.log(`Source: ${source}`);
console.log(`✅ sitemap.xml updated`);
