import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPartners, memoryStore, tokenFor } from '../src/index.js';

const SECRET = 'server-side';
const SITE = 'https://nichedb.test';

function program({ user = null, store = memoryStore(), niches = ['ai', 'security', 'medicine'], ...rest } = {}) {
  const current = { user };
  const p = createPartners({
    siteName: 'NicheDB', siteUrl: SITE, store, secret: SECRET, niches,
    loginUrl: '/login?next=/sell',
    currentUser: () => current.user,
    ...rest,
  });
  return { p, store, as: (u) => { current.user = u; } };
}

const get = (p, path) => p.handle(new Request(SITE + path));
const post = (p, path, fields = {}) => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const one of [].concat(v)) body.append(k, one);
  return p.handle(new Request(SITE + path, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
};
const dnsFor = (token) => async (url) =>
  String(url).includes('dns')
    ? new Response(JSON.stringify({ Answer: [{ type: 16, data: `"pfs-verify=${token}"` }] }), { status: 200 })
    : new Response('', { status: 404 });

test('the pitch is public and shows the ladder', async () => {
  const { p } = program();
  const res = await get(p, '/sell');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Sell what you know/);
  assert.match(body, /20%/);
  assert.match(body, /80%/);
  assert.match(body, /Sign in to start/, 'a stranger is sent to sign in');
});

test('paths outside the base are not ours', async () => {
  const { p } = program();
  assert.equal(await get(p, '/'), null);
  assert.equal(await get(p, '/selling'), null);
  assert.equal(await p.handle(new Request(SITE + '/sell', { method: 'DELETE' })), null);
});

test('signed out, everything past the pitch is closed', async () => {
  const { p } = program();
  const dash = await get(p, '/sell/dashboard');
  assert.equal(dash.status, 303);
  assert.equal(dash.headers.get('location'), '/login?next=/sell');
  assert.equal((await post(p, '/sell/payout', { address: '0x' + 'a'.repeat(40) })).status, 401);
});

test('the whole flow: apply, add, verify, niches, payout', async () => {
  const applied = [];
  const verified = [];
  const { p, as, store } = program({ onApply: (x) => applied.push(x.partner.id), onVerified: (x) => verified.push(x.domain) });
  as({ id: 'u1', name: 'Dr. Okafor' });

  assert.equal((await post(p, '/sell/apply')).headers.get('location'), '/sell/dashboard');
  assert.deepEqual(applied.length, 1);
  // Applying twice must not create a second account.
  await post(p, '/sell/apply');
  assert.equal(store._dump().partners.length, 1);

  let me = await (await get(p, '/sell/me.json')).json();
  assert.equal(me.rate, 20, 'everyone starts at the base rate');

  const add = await post(p, '/sell/properties', { domain: 'https://www.Example.com/blog' });
  assert.equal(add.status, 303);
  assert.match(add.headers.get('location'), /^\/sell\/properties\/\d+$/, 'straight to the instructions');
  const propId = add.headers.get('location').split('/').pop();

  const how = await (await get(p, `/sell/properties/${propId}`)).text();
  const token = await tokenFor(SECRET, 'example.com');
  assert.match(how, new RegExp(token), 'the page shows the real token');
  assert.match(how, /_pfs-verify\.example\.com/);

  // Not published yet.
  const tooSoon = await post(p, `/sell/properties/${propId}/verify`);
  assert.match(decodeURIComponent(tooSoon.headers.get('location')), /error=.*(propagate|found)/);
  me = await (await get(p, '/sell/me.json')).json();
  assert.equal(me.properties[0].verified, false);
  assert.equal(me.rate, 20, 'an unverified property earns nothing');

  // Publish it.
  const { p: p2, as: as2 } = program({ store, fetch: dnsFor(token), onVerified: (x) => verified.push(x.domain) });
  as2({ id: 'u1' });
  const now = await post(p2, `/sell/properties/${propId}/verify`);
  assert.match(decodeURIComponent(now.headers.get('location')), /notice=example\.com is verified/);

  me = await (await get(p2, '/sell/me.json')).json();
  assert.deepEqual(me.properties[0], { domain: 'example.com', verified: true, method: 'dns' });
  assert.equal(me.rate, 25, 'one verified property is +5');
  assert.deepEqual(verified, ['example.com']);

  await post(p2, '/sell/niches', { niche: ['ai', 'security', 'not-a-niche'] });
  me = await (await get(p2, '/sell/me.json')).json();
  assert.deepEqual(me.partner.niches, ['ai', 'security'], 'a niche the site does not offer is dropped');
  assert.equal(me.rate, 35, '+5 per niche');

  const bad = await post(p2, '/sell/payout', { address: 'my paypal' });
  assert.match(decodeURIComponent(bad.headers.get('location')), /error=.*not an address/);
  await post(p2, '/sell/payout', { address: '0x' + 'A'.repeat(40) });
  me = await (await get(p2, '/sell/me.json')).json();
  assert.equal(me.partner.payoutAddress, '0x' + 'A'.repeat(40));
});

test('a domain can only be claimed once, and not by a second partner', async () => {
  const token = await tokenFor(SECRET, 'taken.com');
  const store = memoryStore();
  const { p, as } = program({ store, fetch: dnsFor(token) });
  as({ id: 'u1' });
  await post(p, '/sell/apply');
  const add = await post(p, '/sell/properties', { domain: 'taken.com' });
  await post(p, `/sell/properties/${add.headers.get('location').split('/').pop()}/verify`);

  assert.match(decodeURIComponent((await post(p, '/sell/properties', { domain: 'taken.com' })).headers.get('location')), /already added/);

  as({ id: 'u2' });
  await post(p, '/sell/apply');
  const stolen = await post(p, '/sell/properties', { domain: 'TAKEN.com' });
  assert.match(decodeURIComponent(stolen.headers.get('location')), /already claimed/);
  const me2 = await (await get(p, '/sell/me.json')).json();
  assert.deepEqual(me2.properties, [], 'and it is not on their account');
});

test('one partner cannot verify or remove another partner\'s property', async () => {
  const token = await tokenFor(SECRET, 'mine.com');
  const store = memoryStore();
  const { p, as } = program({ store, fetch: dnsFor(token) });
  as({ id: 'owner' });
  await post(p, '/sell/apply');
  const add = await post(p, '/sell/properties', { domain: 'mine.com' });
  const id = add.headers.get('location').split('/').pop();

  as({ id: 'intruder' });
  await post(p, '/sell/apply');
  assert.match(decodeURIComponent((await post(p, `/sell/properties/${id}/verify`)).headers.get('location')), /No such property/);
  assert.match(decodeURIComponent((await post(p, `/sell/properties/${id}/remove`)).headers.get('location')), /No such property/);
  assert.equal((await get(p, `/sell/properties/${id}`)).headers.get('location'), '/sell/dashboard');

  as({ id: 'owner' });
  const me = await (await get(p, '/sell/me.json')).json();
  assert.equal(me.properties.length, 1, 'still there');
});

test('credit is idempotent and ownerOf resolves a verified domain', async () => {
  const token = await tokenFor(SECRET, 'paid.com');
  const store = memoryStore();
  const { p, as } = program({ store, fetch: dnsFor(token) });
  as({ id: 'u1' });
  await post(p, '/sell/apply');
  const add = await post(p, '/sell/properties', { domain: 'paid.com' });
  const id = add.headers.get('location').split('/').pop();

  assert.equal(await p.ownerOf('paid.com'), null, 'unverified owns nothing');
  await post(p, `/sell/properties/${id}/verify`);

  const owner = await p.ownerOf('https://www.paid.com/some/page');
  assert.equal(owner.rate, 25);
  assert.equal(owner.property.domain, 'paid.com');

  assert.equal(await p.credit({ partnerId: owner.partner.id, cents: 900, ref: 'sale-1' }), true);
  assert.equal(await p.credit({ partnerId: owner.partner.id, cents: 900, ref: 'sale-1' }), false, 'a replayed sale books once');
  await p.credit({ partnerId: owner.partner.id, cents: 100, ref: 'sale-2' });

  const me = await (await get(p, '/sell/me.json')).json();
  assert.deepEqual(me.earnings, { cents: 1000, credits: 2 });
  const dash = await (await get(p, '/sell/dashboard')).text();
  assert.match(dash, /\$10\.00/);
});

test('a junk domain is refused with a usable message', async () => {
  const { p, as } = program();
  as({ id: 'u1' });
  await post(p, '/sell/apply');
  const res = await post(p, '/sell/properties', { domain: 'localhost' });
  assert.match(decodeURIComponent(res.headers.get('location')), /does not look like a domain/);
});

test('niches may be a function, resolved per request', async () => {
  let offered = ['ai'];
  const { p, as } = program({ niches: () => offered });
  as({ id: 'u1' });
  await post(p, '/sell/apply');

  await post(p, '/sell/niches', { niche: ['ai', 'quantum'] });
  let me = await (await get(p, '/sell/me.json')).json();
  assert.deepEqual(me.partner.niches, ['ai'], 'quantum is not offered yet');

  // A niche added to the site today is claimable today, with no restart.
  offered = ['ai', 'quantum'];
  await post(p, '/sell/niches', { niche: ['ai', 'quantum'] });
  me = await (await get(p, '/sell/me.json')).json();
  assert.deepEqual(me.partner.niches, ['ai', 'quantum']);
  assert.match(await (await get(p, '/sell/dashboard')).text(), /quantum/);
});
