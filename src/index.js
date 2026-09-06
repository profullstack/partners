import { commissionLadder } from '@profullstack/leaderboard';
import { memoryStore } from './store/memory.js';
import { dashboardPage, landingPage, verifyPage } from './pages.js';
import { checkDomain, instructionsFor, normaliseDomain } from './verify.js';

export { commissionLadder } from '@profullstack/leaderboard';
export { memoryStore } from './store/memory.js';
export { sqlStore } from './store/sql.js';
export { checkDomain, instructionsFor, normaliseDomain, tokenFor } from './verify.js';

/**
 * The seller side of a dataset: signup, domain verification, niches, a
 * commission rate that climbs, a payout address, and earnings.
 *
 *   const partners = createPartners({
 *     siteName: 'NicheDB', siteUrl: 'https://nichedb.dev',
 *     store: sqlStore({ execute, dialect: 'postgres' }),
 *     secret: process.env.PARTNER_VERIFY_SECRET,
 *     currentUser: async (request) => sessionUser(request),
 *     loginUrl: '/login?next=/sell',
 *     niches: ['ai', 'security', 'medicine'],
 *   });
 *   app.use('*', partners.middleware());     // or partners.handle(request)
 *
 * Authentication is the host's job. This module never sees a password, issues
 * no session and owns no login: it asks `currentUser(request)` who is here and
 * sends anyone else to `loginUrl`. That is what lets it drop onto a site whose
 * accounts already exist, which is every site worth putting it on.
 */
export function createPartners(options = {}) {
  const store = options.store ?? memoryStore();
  const basePath = trimSlash(options.basePath ?? '/sell');
  const siteName = options.siteName ?? 'this dataset';
  const siteUrl = options.siteUrl ? trimSlash(options.siteUrl) : '';
  const ladder = options.ladder ?? commissionLadder();
  // An array, or a function returning one: a site's niche vocabulary usually
  // lives in its database, and freezing it at import means a collection added
  // today cannot be claimed today.
  const nichesOption = options.niches ?? [];
  const resolveNiches = async () => {
    const list = typeof nichesOption === 'function' ? await safely(() => nichesOption()) : nichesOption;
    return (Array.isArray(list) ? list : []).map(String);
  };
  const loginUrl = options.loginUrl ?? '/login';
  const prefix = options.prefix ?? 'pfs-verify';
  const currentUser = options.currentUser ?? (() => null);
  const secret = options.secret ?? null;
  const fetchImpl = options.fetch ?? fetch;
  const stats = options.stats ?? null;
  const onApply = options.onApply ?? null;
  const onVerified = options.onVerified ?? null;
  const maxProperties = Number(options.maxProperties ?? 25);

  if (!secret) {
    // A verification token derived from an empty secret is guessable, and a
    // guessable token means anyone can claim anyone's domain and be paid for
    // their work. Refuse at construction rather than pay the wrong person.
    throw new TypeError('createPartners needs a `secret`: verification tokens are derived from it');
  }

  /** A partner's own view. Nothing here is another partner's data. */
  async function contextFor(user) {
    const partner = await store.getPartner(user.id);
    if (!partner) return { partner: null };
    const [properties, earnings] = await Promise.all([store.listProperties(partner.id), store.earnings(partner.id)]);
    return { partner, properties, earnings };
  }

  function rateFor(partner, properties) {
    return ladder.rate({ properties: properties.filter((p) => p.verifiedAt).length, niches: partner.niches.length });
  }

  /**
   * Credit a partner. The host decides attribution, because only it knows
   * whose rows were in the crawl that got paid for.
   *
   * `ref` makes it idempotent: the same payment replayed books once.
   */
  async function credit({ partnerId, cents, ref, at }) {
    return store.credit({ partnerId: String(partnerId), cents: Number(cents) || 0, ref: ref ?? null, at: at ?? Date.now() });
  }

  /** Who owns a domain, and at what rate, so a host can split revenue. */
  async function ownerOf(domain) {
    const d = normaliseDomain(domain);
    if (!d) return null;
    const property = await store.findProperty(d);
    if (!property?.verifiedAt) return null;
    const partner = await store.getPartnerById(property.partnerId);
    if (!partner) return null;
    const properties = await store.listProperties(partner.id);
    return { partner, property, rate: rateFor(partner, properties) };
  }

  async function handle(request) {
    const url = new URL(request.url);
    const path = trimSlash(url.pathname);
    if (path !== basePath && !path.startsWith(`${basePath}/`)) return null;
    const rest = path === basePath ? '' : path.slice(basePath.length);
    const method = request.method.toUpperCase();
    // Only the verbs this program implements. Claiming PUT or DELETE just to
    // answer 401 would stop the host handling them, and would tell an
    // unauthenticated caller that the path exists.
    if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') return null;
    const user = await currentUser(request);

    // The pitch is public: it is the page that convinces someone to sign up.
    if (rest === '' && method === 'GET') {
      const ctx = user ? await contextFor(user) : { partner: null };
      return html(
        landingPage({ siteName, basePath, ladder, loginUrl, user, partner: ctx.partner, niches: await resolveNiches(), stats: await resolveStats() }),
      );
    }

    if (!user) {
      // Everything past the pitch is somebody's own money.
      if (method === 'GET') return redirect(loginUrl);
      return html(landingPage({ siteName, basePath, ladder, loginUrl, user: null, partner: null, niches: await resolveNiches(), stats: null }), 401);
    }

    if (rest === '/apply' && method === 'POST') {
      let partner = await store.getPartner(user.id);
      if (!partner) {
        partner = await store.createPartner({ userId: user.id, name: user.name ?? user.email ?? null });
        if (onApply) await safely(() => onApply({ partner, user }));
      }
      return redirect(`${basePath}/dashboard`);
    }

    const ctx = await contextFor(user);
    if (!ctx.partner) {
      if (method === 'GET') return redirect(basePath);
      return redirect(basePath);
    }
    const { partner } = ctx;

    if (rest === '/dashboard' && method === 'GET') {
      return html(
        dashboardPage({
          siteName, basePath, ladder, partner, prefix,
          properties: ctx.properties,
          earnings: ctx.earnings,
          niches: await resolveNiches(),
          notice: url.searchParams.get('notice'),
          error: url.searchParams.get('error'),
        }),
      );
    }

    if (rest === '/properties' && method === 'POST') {
      const form = await formOf(request);
      const domain = normaliseDomain(form.get('domain'));
      if (!domain) return back('That does not look like a domain. Try example.com.');
      if (ctx.properties.length >= maxProperties) return back(`A partner may hold ${maxProperties} properties.`);
      const existing = await store.findProperty(domain);
      if (existing) {
        // Someone else's verified domain is not available, and saying which
        // account holds it would leak it. Same answer either way.
        return back(
          existing.partnerId === partner.id
            ? 'You have already added that domain.'
            : 'That domain is already claimed. If it is yours, contact us.',
        );
      }
      const property = await store.addProperty({ partnerId: partner.id, domain });
      return redirect(`${basePath}/properties/${property.id}`);
    }

    let m;
    if ((m = rest.match(/^\/properties\/([^/]+)$/)) && method === 'GET') {
      const property = (ctx.properties ?? []).find((p) => p.id === m[1]);
      if (!property) return redirect(`${basePath}/dashboard`);
      return html(verifyPage({ siteName, basePath, property, instructions: await instructionsFor({ secret, domain: property.domain, prefix }) }));
    }

    if ((m = rest.match(/^\/properties\/([^/]+)\/verify$/)) && method === 'POST') {
      const property = (ctx.properties ?? []).find((p) => p.id === m[1]);
      if (!property) return back('No such property.');
      if (property.verifiedAt) return back('That one is already verified.');
      const result = await checkDomain({ secret, domain: property.domain, prefix, fetch: fetchImpl });
      if (!result.ok) return back(result.reason ?? 'Not verified yet.');
      await store.updateProperty(property.id, { verifiedAt: Date.now(), method: result.method });
      if (onVerified) await safely(() => onVerified({ partner, domain: property.domain, method: result.method }));
      return redirect(`${basePath}/dashboard?notice=${encodeURIComponent(`${property.domain} is verified. Your rate went up.`)}`);
    }

    if ((m = rest.match(/^\/properties\/([^/]+)\/remove$/)) && method === 'POST') {
      const property = (ctx.properties ?? []).find((p) => p.id === m[1]);
      if (!property) return back('No such property.');
      await store.removeProperty(property.id);
      return redirect(`${basePath}/dashboard?notice=${encodeURIComponent(`${property.domain} removed.`)}`);
    }

    if (rest === '/niches' && method === 'POST') {
      const form = await formOf(request);
      const offered = await resolveNiches();
      const chosen = [...new Set(form.getAll('niche').map(String))].filter((n) => offered.includes(n));
      await store.updatePartner(partner.id, { niches: chosen });
      return redirect(`${basePath}/dashboard?notice=${encodeURIComponent('Niches saved.')}`);
    }

    if (rest === '/payout' && method === 'POST') {
      const form = await formOf(request);
      const address = String(form.get('address') ?? '').trim();
      if (address && !/^0x[0-9a-fA-F]{40}$/.test(address))
        return back('That is not an address. It should look like 0x followed by 40 hex characters.');
      await store.updatePartner(partner.id, { payoutAddress: address || null });
      return redirect(`${basePath}/dashboard?notice=${encodeURIComponent(address ? 'Payout address saved.' : 'Payout address cleared.')}`);
    }

    if (rest === '/me.json' && method === 'GET') {
      return json({
        partner: { id: partner.id, name: partner.name, niches: partner.niches, payoutAddress: partner.payoutAddress },
        properties: ctx.properties.map((p) => ({ domain: p.domain, verified: Boolean(p.verifiedAt), method: p.method })),
        rate: rateFor(partner, ctx.properties),
        earnings: ctx.earnings,
      });
    }

    return null;

    function back(message) {
      return redirect(`${basePath}/dashboard?error=${encodeURIComponent(message)}`);
    }
  }

  async function resolveStats() {
    if (typeof stats === 'function') return safely(() => stats());
    return stats;
  }

  return {
    handle,
    credit,
    ownerOf,
    rateFor,
    ladder,
    basePath,
    niches: resolveNiches,
    /** Hono-shaped middleware, for the common case. */
    middleware() {
      return async (c, next) => {
        const answer = await handle(c.req.raw);
        if (answer) return answer;
        await next();
      };
    },
  };
}

async function safely(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

async function formOf(request) {
  try {
    return await request.formData();
  } catch {
    return new URLSearchParams();
  }
}

function trimSlash(s) {
  return String(s).replace(/\/+$/, '') || '/';
}

function html(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

function redirect(to) {
  return new Response(null, { status: 303, headers: { location: to, 'cache-control': 'no-store' } });
}
