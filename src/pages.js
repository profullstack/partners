import { format } from '@profullstack/leaderboard';

/**
 * The pages. Server-rendered HTML with no client framework, because this is a
 * short form-driven flow and every step has to work before a partner trusts us
 * with a payout address.
 */

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#111827;--muted:#6b7280;--line:#e5e7eb;--accent:#2563eb;--ok:#047857;--warn:#b45309;--panel:#f9fafb}
@media (prefers-color-scheme:dark){:root{--bg:#0f1219;--fg:#e8eaf0;--muted:#8b93a7;--line:#242a38;--accent:#7cc4ff;--ok:#34d399;--warn:#fbbf24;--panel:#151a24}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:40px 20px 80px}
h1{font-size:30px;margin:0 0 8px;letter-spacing:-0.02em}h2{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin:36px 0 10px}
p{margin:0 0 14px}.muted{color:var(--muted)}.lede{font-size:17px}
a{color:var(--accent)}
.card{border:1px solid var(--line);border-radius:12px;padding:18px;margin:0 0 14px;background:var(--panel)}
.rate{font-size:44px;font-weight:800;letter-spacing:-0.03em;margin:0}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
input[type=text],input[type=url]{font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);min-width:280px;flex:1}
button{font:inherit;font-weight:600;padding:10px 16px;border-radius:8px;border:0;background:var(--accent);color:#fff;cursor:pointer}
button.quiet{background:transparent;color:var(--muted);border:1px solid var(--line);font-weight:500}
table{width:100%;border-collapse:collapse;margin:6px 0}td,th{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line)}
th{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto}
.ok{color:var(--ok);font-weight:600}.warn{color:var(--warn);font-weight:600}
.notice{border-left:3px solid var(--accent);padding:10px 14px;margin:0 0 18px;background:var(--panel);border-radius:0 8px 8px 0}
.notice.bad{border-left-color:var(--warn)}
label{display:block;font-size:13px;color:var(--muted);margin:0 0 6px}
ul.niches{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px}
ul.niches li{margin:0}
ul.niches label{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--line);border-radius:999px;padding:6px 12px;cursor:pointer;color:var(--fg);font-size:14px;margin:0}
`;

function shell({ title, siteName, body, basePath }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} &mdash; ${esc(siteName)}</title>
<meta name="robots" content="index,follow">
<style>${STYLE}</style></head>
<body><main>
<p class="muted"><a href="${esc(basePath)}">${esc(siteName)} partners</a></p>
${body}
</main></body></html>`;
}

/** The pitch. Everything a stranger needs before deciding to sign up. */
export function landingPage({ siteName, basePath, ladder, loginUrl, user, partner, niches, stats }) {
  const steps = ladder.table().filter((r) => r.niches === r.properties).slice(0, 7);
  const rows = steps
    .map((r) => `<tr><td>${r.properties} propert${r.properties === 1 ? 'y' : 'ies'}, ${r.niches} niche${r.niches === 1 ? '' : 's'}</td><td><strong>${r.rate}%</strong></td></tr>`)
    .join('');
  const cta = partner
    ? `<p><a href="${esc(basePath)}/dashboard"><button>Open your dashboard</button></a></p>`
    : user
      ? `<form method="post" action="${esc(basePath)}/apply"><button>Start selling</button></form>`
      : `<p><a href="${esc(loginUrl)}"><button>Sign in to start</button></a></p>
         <p class="muted">Signing in is a magic link. There is no password to invent.</p>`;
  const measured = stats?.crawlerShare
    ? `<p>On this site, <strong>${esc(stats.crawlerShare)}</strong> of requests are already machines rather than people${stats.topAgent ? `, led by <strong>${esc(stats.topAgent)}</strong>` : ''}. They are reading whether or not anyone is paid for it.</p>`
    : '';
  return shell({
    title: 'Sell what you know',
    siteName,
    basePath,
    body: `
<h1>Sell what you know to the machines reading it</h1>
<p class="lede">Your writing is already being crawled to train models. This is how you get paid for it instead.</p>
${measured}
<h2>How it works</h2>
<p>Add a site you own and prove you control it. Say which subjects you publish on. When a training crawler buys access to this dataset, your share of that money is paid to your wallet.</p>
<h2>Your rate</h2>
<p>Everyone starts at <strong>${ladder.base}%</strong>. Each verified property and each niche you publish into raises it, up to <strong>${ladder.cap}%</strong>.</p>
<table><thead><tr><th>What you bring</th><th>Your cut</th></tr></thead><tbody>${rows}</tbody></table>
<p class="muted">${esc(ladder.describe())}</p>
<h2>What you need</h2>
<p>A site you can add a DNS record to, or upload one file to. A wallet address to be paid at. Nothing else, and no exclusivity: keep publishing wherever you already do.</p>
${cta}
<p class="muted">Niches on this dataset: ${niches.slice(0, 12).map((n) => esc(n)).join(', ')}${niches.length > 12 ? ', and more' : ''}.</p>
`,
  });
}

/** The dashboard: rate, the next step up, properties, niches, payout, earnings. */
export function dashboardPage({ siteName, basePath, ladder, partner, properties, earnings, niches, notice, error, prefix }) {
  const verified = properties.filter((p) => p.verifiedAt);
  const rate = ladder.rate({ properties: verified.length, niches: partner.niches.length });
  const next = ladder.next({ properties: verified.length, niches: partner.niches.length });
  const propertyRows = properties.length
    ? properties
        .map(
          (p) => `<tr>
            <td><strong>${esc(p.domain)}</strong></td>
            <td>${p.verifiedAt ? `<span class="ok">verified</span> <span class="muted">(${esc(p.method ?? '')})</span>` : '<span class="warn">unverified</span>'}</td>
            <td class="row" style="justify-content:flex-end">
              ${p.verifiedAt ? '' : `<form method="post" action="${esc(basePath)}/properties/${esc(p.id)}/verify"><button>Check now</button></form>
              <a href="${esc(basePath)}/properties/${esc(p.id)}">how</a>`}
              <form method="post" action="${esc(basePath)}/properties/${esc(p.id)}/remove"><button class="quiet">Remove</button></form>
            </td></tr>`,
        )
        .join('')
    : `<tr><td colspan="3" class="muted">No properties yet. Add the site your work is on.</td></tr>`;

  const nicheBoxes = niches
    .map(
      (n) => `<li><label><input type="checkbox" name="niche" value="${esc(n)}"${partner.niches.includes(n) ? ' checked' : ''}> ${esc(n)}</label></li>`,
    )
    .join('');

  return shell({
    title: 'Your partner dashboard',
    siteName,
    basePath,
    body: `
${notice ? `<div class="notice">${esc(notice)}</div>` : ''}
${error ? `<div class="notice bad">${esc(error)}</div>` : ''}
<h1>${esc(partner.name || 'Your dashboard')}</h1>

<div class="card">
  <p class="muted" style="margin:0">Your commission rate</p>
  <p class="rate">${rate}%</p>
  <p class="muted" style="margin:0">${
    next
      ? `Add one more ${esc(next.add)} and it becomes ${next.rate}%.`
      : `That is the cap. ${esc(ladder.describe())}`
  }</p>
</div>

<div class="card">
  <p class="muted" style="margin:0">Earned so far</p>
  <p class="rate">${esc(format(earnings.cents, 'usd'))}</p>
  <p class="muted" style="margin:0">${earnings.credits} payment${earnings.credits === 1 ? '' : 's'} attributed to your properties.${
    earnings.cents === 0 ? ' Nothing yet: this fills in when a crawler buys access.' : ''
  }</p>
</div>

<h2>Properties (${verified.length} verified)</h2>
<table><tbody>${propertyRows}</tbody></table>
<form method="post" action="${esc(basePath)}/properties" class="row">
  <input type="text" name="domain" placeholder="example.com" required>
  <button>Add property</button>
</form>
<p class="muted">Only verified properties count towards your rate. Verify with a DNS TXT record or one file at <code>/.well-known/${esc(prefix)}.txt</code>.</p>

<h2>Niches (${partner.niches.length})</h2>
<form method="post" action="${esc(basePath)}/niches">
  <ul class="niches">${nicheBoxes}</ul>
  <p style="margin-top:14px"><button>Save niches</button></p>
</form>

<h2>Payout</h2>
<form method="post" action="${esc(basePath)}/payout" class="row">
  <div style="flex:1">
    <label for="payout">USDC address on Base. This is where your share is sent.</label>
    <input id="payout" type="text" name="address" placeholder="0x…" value="${esc(partner.payoutAddress ?? '')}" style="width:100%">
  </div>
  <button>Save</button>
</form>
${partner.payoutAddress ? '' : '<p class="warn">Without a payout address there is nowhere to send your money.</p>'}
`,
  });
}

/** How to verify one property. Its own page so the instructions can be linked and revisited. */
export function verifyPage({ siteName, basePath, property, instructions, error }) {
  return shell({
    title: `Verify ${property.domain}`,
    siteName,
    basePath,
    body: `
${error ? `<div class="notice bad">${esc(error)}</div>` : ''}
<h1>Prove you own ${esc(property.domain)}</h1>
<p>Either one works, and the value never changes, so a half-finished attempt is safe to resume.</p>

<h2>Option 1: a DNS record</h2>
<pre>${esc(instructions.dns.type)}  ${esc(instructions.dns.host)}  ${esc(instructions.dns.value)}</pre>
<p class="muted">DNS can take a few minutes to reach us. Checking early does no harm.</p>

<h2>Option 2: a file</h2>
<pre>${esc(instructions.file.url)}

${esc(instructions.file.contents)}</pre>
<p class="muted">One line, nothing else in the file.</p>

<form method="post" action="${esc(basePath)}/properties/${esc(property.id)}/verify" class="row" style="margin-top:24px">
  <button>Check it now</button>
  <a href="${esc(basePath)}/dashboard" class="muted">Back to the dashboard</a>
</form>
`,
  });
}
