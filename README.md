# @profullstack/partners

Let the people whose work is in your dataset sell it.

Signup, domain verification, niches, a commission rate that climbs, a payout address and earnings, as one Fetch API handler you mount on the auth you already have.

Zero runtime dependencies beyond `@profullstack/leaderboard`, whose commission ladder it shares so the rate a partner is shown is the same one the public board displays.

## Why it exists

Training crawlers read your dataset whether or not anyone is paid for it. If the rows came from other people, this is the part that pays them: they prove they own a site, say what they publish about, and take a share of what a crawler pays for access.

## Install

```sh
npm i @profullstack/partners
```

## Mount it

```js
import { createPartners, sqlStore } from '@profullstack/partners';

const store = sqlStore({ execute, dialect: 'postgres' });
await store.migrate();

const partners = createPartners({
  siteName: 'NicheDB',
  siteUrl: 'https://nichedb.dev',
  basePath: '/sell',
  store,
  secret: process.env.PARTNER_VERIFY_SECRET,   // required
  currentUser: async (request) => userFromSession(request),
  loginUrl: '/login?next=/sell',
  niches: ['medicine', 'ai', 'security', 'law'],
});

app.use('*', partners.middleware());   // Hono
```

**Authentication stays yours.** This module never sees a password, issues no session and owns no login. It asks `currentUser(request)` who is here and sends everyone else to `loginUrl`. That is what lets it drop onto a site whose accounts already exist.

`secret` is required at construction, because verification tokens are derived from it. A guessable token means anyone can claim anyone's domain and be paid for their work, so an absent secret is a `TypeError` rather than a default.

## What a partner walks through

| Path | What happens |
| --- | --- |
| `GET /sell` | The pitch: the ladder, what they need, one button. Public. |
| `POST /sell/apply` | Becomes a partner. Idempotent. |
| `GET /sell/dashboard` | Rate, next step up, properties, niches, payout, earnings. |
| `POST /sell/properties` | Adds a domain, then straight to its instructions. |
| `GET /sell/properties/:id` | How to verify, both methods, same token every time. |
| `POST /sell/properties/:id/verify` | Checks it now. |
| `POST /sell/niches` | Saves the niches they publish into. |
| `POST /sell/payout` | Saves a USDC address on Base. |
| `GET /sell/me.json` | The same, as data. |

Everything past the pitch requires a session, and every property lookup is scoped to the partner asking, so one partner cannot verify, view or remove another's domain.

## Verification

Two methods, both automated. There is no "email us" path, because a manual step is a step nobody takes at 2am.

```
TXT  _pfs-verify.example.com  pfs-verify=<token>
```
```
https://example.com/.well-known/pfs-verify.txt   ->  <token>
```

The token is an HMAC of the domain under your `secret`: stable, so a half-finished attempt resumes with the same instructions, and unguessable without the secret. DNS is read over DNS-over-HTTPS through `fetch` (Cloudflare, then Google) so this runs at the edge and needs no resolver. TXT answers only: a CNAME in the chain is never read as a token.

## The rate, and getting paid

```js
partners.rateFor(partner, properties)   // 20 + 5 per verified property + 5 per niche, capped at 80
```

Attribution is yours, because only you know whose rows were in the crawl that got paid for:

```js
const owner = await partners.ownerOf('example.com');   // null unless verified
if (owner) {
  await partners.credit({
    partnerId: owner.partner.id,
    cents: Math.round(saleCents * owner.rate / 100),
    ref: sale.ref,        // idempotent: a replayed settlement books once
  });
}
```

## Stores

```js
memoryStore()                                          // tests, one process
sqlStore({ execute, prefix: 'partner_', dialect })     // 'sqlite' (default) or 'postgres'
```

`sqlStore` needs `execute({ sql, args }) -> { rows }`, which is `@libsql/client` as is. `store.schema` is the DDL for your own migration tool. Three tables: accounts, properties, credits. Removing a property never erases what it earned.

## Next.js

```js
// app/sell/[[...path]]/route.js
import { partnersRoute } from '@profullstack/partners/next';
export const { GET, POST } = partnersRoute(partners);
export const dynamic = 'force-dynamic';
```

## License

MIT
