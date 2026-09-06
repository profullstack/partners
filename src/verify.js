/**
 * Proving somebody owns the domain they are about to be paid for.
 *
 * This is the load-bearing check in the whole program. Everything downstream
 * (a commission rate, a payout address, a share of crawl revenue) assumes the
 * person who added `example.com` actually controls it, so a verification that
 * can be faked is a verification that pays strangers for other people's work.
 *
 * Two methods, both automated. There is no "email us to get verified" path,
 * because a manual step is a step nobody takes at 2am.
 *
 * The token is derived from a server-side secret and the domain, so it is
 * stable (the same instructions on every visit, which matters when DNS takes
 * a while to propagate) and unguessable without the secret.
 */

const encoder = new TextEncoder();

/** Lowercase hex of an HMAC, which is what a DNS TXT value has to be. */
async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A domain, or null if the input is not one.
 *
 * Deliberately strict. A partner pastes "https://example.com/blog?utm=x" as
 * often as "example.com", so the URL shapes are unwrapped rather than
 * rejected; anything still not a bare hostname after that is refused rather
 * than half-accepted, because a malformed row here becomes an unverifiable
 * property nobody can delete.
 */
export function normaliseDomain(input) {
  let value = String(input ?? '').trim().toLowerCase();
  if (!value) return null;
  if (value.includes('://')) {
    try {
      value = new URL(value).hostname;
    } catch {
      return null;
    }
  } else {
    value = value.split('/')[0];
  }
  value = value.replace(/^www\./, '').replace(/\.$/, '').replace(/:\d+$/, '');
  if (value.length > 253 || !value.includes('.')) return null;
  // Labels: letters, digits and hyphens, not starting or ending with a hyphen.
  if (!/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(value)) return null;
  // A bare TLD is not a property, and neither is an IP address.
  if (/^\d+(\.\d+)*$/.test(value)) return null;
  return value;
}

/** The token a domain must publish. Stable for a given (secret, domain). */
export async function tokenFor(secret, domain) {
  const hex = await hmacHex(secret, `verify:${domain}`);
  return hex.slice(0, 32);
}

/**
 * What to tell the partner to do. Both methods, because whoever can edit DNS
 * is often not whoever can deploy the site.
 */
export async function instructionsFor({ secret, domain, prefix = 'pfs-verify' }) {
  const token = await tokenFor(secret, domain);
  return {
    domain,
    token,
    dns: { type: 'TXT', host: `_${prefix}.${domain}`, value: `${prefix}=${token}` },
    file: { url: `https://${domain}/.well-known/${prefix}.txt`, contents: token },
  };
}

/**
 * Resolve TXT records over DNS-over-HTTPS.
 *
 * `fetch` rather than `node:dns` so the same code runs on an edge runtime, and
 * so the package keeps no dependencies. Cloudflare first, Google as the
 * fallback: a partner whose verification fails because one resolver is having
 * an afternoon will simply conclude the product is broken.
 */
export async function resolveTxt(host, { fetch: f = fetch, timeoutMs = 5000 } = {}) {
  const resolvers = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=TXT`,
    `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=TXT`,
  ];
  for (const url of resolvers) {
    try {
      const res = await withTimeout(f(url, { headers: { accept: 'application/dns-json' } }), timeoutMs);
      if (!res?.ok) continue;
      const body = await res.json();
      const answers = Array.isArray(body?.Answer) ? body.Answer : [];
      const values = answers
        // Type 16 is TXT. A CNAME in the chain answers with its own type and
        // must not be read as a token.
        .filter((a) => Number(a?.type) === 16)
        .map((a) => String(a?.data ?? '').replace(/^"|"$/g, '').replaceAll('" "', ''));
      if (values.length) return values;
    } catch {
      // Try the next resolver.
    }
  }
  return [];
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check both methods and say which one passed.
 *
 * The file check reads a bounded number of bytes: a "well-known file" that is
 * actually a 2GB video should fail verification, not the process.
 */
export async function checkDomain({ secret, domain, prefix = 'pfs-verify', fetch: f = fetch, timeoutMs = 5000 }) {
  const token = await tokenFor(secret, domain);
  const expected = `${prefix}=${token}`;

  const txt = await resolveTxt(`_${prefix}.${domain}`, { fetch: f, timeoutMs });
  if (txt.some((v) => v.trim() === expected || v.trim() === token)) return { ok: true, method: 'dns', token };

  try {
    const res = await withTimeout(
      f(`https://${domain}/.well-known/${prefix}.txt`, { redirect: 'follow', headers: { accept: 'text/plain' } }),
      timeoutMs,
    );
    if (res?.ok) {
      const body = (await res.text()).slice(0, 4096);
      if (body.trim().split(/\s+/)[0] === token) return { ok: true, method: 'file', token };
    }
  } catch {
    // Falls through to the failure below.
  }

  return {
    ok: false,
    method: null,
    token,
    reason: txt.length
      ? 'A TXT record is there but does not match. Check for a stale value from an earlier attempt.'
      : 'Neither the DNS record nor the file was found. DNS can take a few minutes to propagate.',
  };
}
