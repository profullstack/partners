import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDomain, instructionsFor, normaliseDomain, tokenFor } from '../src/verify.js';

const SECRET = 'a-server-side-secret';

test('domains are normalised, and non-domains refused', () => {
  assert.equal(normaliseDomain('Example.COM'), 'example.com');
  assert.equal(normaliseDomain('https://www.example.com/blog?a=1'), 'example.com');
  assert.equal(normaliseDomain('example.com.'), 'example.com');
  assert.equal(normaliseDomain('example.com:8443'), 'example.com');
  assert.equal(normaliseDomain('a.b.example.com'), 'a.b.example.com');
  for (const bad of ['', '   ', 'localhost', 'not a domain', '1.2.3.4', '-bad.com', 'bad-.com', 'com', 'http://', null, undefined])
    assert.equal(normaliseDomain(bad), null, `${bad} should not be a domain`);
});

test('the token is stable per domain and unguessable without the secret', async () => {
  const a = await tokenFor(SECRET, 'example.com');
  assert.equal(a, await tokenFor(SECRET, 'example.com'), 'stable, so half-finished setup can resume');
  assert.notEqual(a, await tokenFor(SECRET, 'other.com'));
  assert.notEqual(a, await tokenFor('different-secret', 'example.com'));
  assert.match(a, /^[0-9a-f]{32}$/);
});

test('a TXT record verifies, and only the right one', async () => {
  const token = await tokenFor(SECRET, 'example.com');
  const dns = (values) => async (url) =>
    new Response(JSON.stringify({ Answer: values.map((data) => ({ type: 16, data })) }), { status: 200 });

  const ok = await checkDomain({ secret: SECRET, domain: 'example.com', fetch: dns([`"pfs-verify=${token}"`]) });
  assert.deepEqual([ok.ok, ok.method], [true, 'dns']);

  const bare = await checkDomain({ secret: SECRET, domain: 'example.com', fetch: dns([`"${token}"`]) });
  assert.equal(bare.ok, true, 'the bare token is accepted too');

  // Someone else's token, and a plausible-looking fake.
  const other = await tokenFor(SECRET, 'attacker.com');
  for (const value of [`"pfs-verify=${other}"`, '"pfs-verify=deadbeef"', '"unrelated=1"'])
    assert.equal((await checkDomain({ secret: SECRET, domain: 'example.com', fetch: dns([value]) })).ok, false, value);
});

test('a CNAME in the answer is not read as a token', async () => {
  const token = await tokenFor(SECRET, 'example.com');
  // Type 5 is CNAME. A resolver often returns it alongside, and treating any
  // answer as TXT would let an unrelated record verify a domain.
  const fetchImpl = async () =>
    new Response(JSON.stringify({ Answer: [{ type: 5, data: `pfs-verify=${token}` }] }), { status: 200 });
  assert.equal((await checkDomain({ secret: SECRET, domain: 'example.com', fetch: fetchImpl })).ok, false);
});

test('the file method verifies, and a wrong file does not', async () => {
  const token = await tokenFor(SECRET, 'example.com');
  const serve = (body, status = 200) => async (url) => {
    if (String(url).includes('dns')) return new Response(JSON.stringify({ Answer: [] }), { status: 200 });
    return new Response(body, { status });
  };
  assert.equal((await checkDomain({ secret: SECRET, domain: 'example.com', fetch: serve(`${token}\n`) })).method, 'file');
  assert.equal((await checkDomain({ secret: SECRET, domain: 'example.com', fetch: serve('nope') })).ok, false);
  assert.equal((await checkDomain({ secret: SECRET, domain: 'example.com', fetch: serve(token, 404) })).ok, false);
  // A huge body must not be swallowed whole, and must not verify.
  assert.equal((await checkDomain({ secret: SECRET, domain: 'example.com', fetch: serve('x'.repeat(200000)) })).ok, false);
});

test('a dead resolver falls through to the next, then reports why', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    if (String(url).includes('cloudflare')) throw new Error('network');
    if (String(url).includes('dns.google')) return new Response(JSON.stringify({ Answer: [] }), { status: 200 });
    return new Response('', { status: 404 });
  };
  const r = await checkDomain({ secret: SECRET, domain: 'example.com', fetch: fetchImpl });
  assert.equal(r.ok, false);
  assert.ok(calls >= 2, 'the second resolver is tried');
  assert.match(r.reason, /propagate/);
});

test('instructions name both methods and carry the same token', async () => {
  const i = await instructionsFor({ secret: SECRET, domain: 'example.com' });
  assert.equal(i.dns.host, '_pfs-verify.example.com');
  assert.equal(i.dns.value, `pfs-verify=${i.token}`);
  assert.equal(i.file.url, 'https://example.com/.well-known/pfs-verify.txt');
  assert.equal(i.file.contents, i.token);
});
