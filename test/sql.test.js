import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createPartners, sqlStore, tokenFor } from '../src/index.js';

function client() {
  const db = new DatabaseSync(':memory:');
  return {
    execute({ sql, args = [] }) {
      const stmt = db.prepare(sql);
      if (/^\s*(select|with)/i.test(sql)) return { rows: stmt.all(...args) };
      stmt.run(...args);
      return { rows: [] };
    },
  };
}

test('the SQL store round-trips against real sqlite', async () => {
  const store = sqlStore(client());
  await store.migrate();
  await store.migrate(); // idempotent

  const partner = await store.createPartner({ userId: 'u1', name: 'Dr. Okafor' });
  assert.equal(partner.userId, 'u1');
  assert.deepEqual(partner.niches, []);
  assert.equal((await store.getPartner('u1')).id, partner.id);
  assert.equal(await store.getPartner('nobody'), null);

  await store.updatePartner(partner.id, { niches: ['ai', 'security'], payoutAddress: '0x' + 'b'.repeat(40) });
  const back = await store.getPartner('u1');
  assert.deepEqual(back.niches, ['ai', 'security'], 'a list survives the round trip');
  assert.equal(back.payoutAddress, '0x' + 'b'.repeat(40));

  const prop = await store.addProperty({ partnerId: partner.id, domain: 'example.com' });
  assert.equal(prop.verifiedAt, null);
  assert.equal((await store.findProperty('example.com')).id, prop.id);
  await store.updateProperty(prop.id, { verifiedAt: 1234, method: 'dns' });
  const props = await store.listProperties(partner.id);
  assert.deepEqual([props.length, props[0].verifiedAt, props[0].method], [1, 1234, 'dns']);

  assert.equal(await store.credit({ partnerId: partner.id, cents: 500, ref: 'r1' }), true);
  assert.equal(await store.credit({ partnerId: partner.id, cents: 500, ref: 'r1' }), false);
  await store.credit({ partnerId: partner.id, cents: 250, ref: 'r2' });
  assert.deepEqual(await store.earnings(partner.id), { cents: 750, credits: 2 });

  await store.removeProperty(prop.id);
  assert.deepEqual(await store.listProperties(partner.id), []);
  assert.deepEqual(await store.earnings(partner.id), { cents: 750, credits: 2 }, 'removing a property does not erase what it earned');
});

test('postgres dialect rewrites placeholders and picks its own types', async () => {
  const seen = [];
  const store = sqlStore({ execute: async (q) => { seen.push(q); return { rows: [] }; }, dialect: 'postgres', prefix: 'p_' });
  await store.getPartner('u1');
  assert.match(seen[0].sql, /WHERE user_id = \$1/);
  assert.match(store.schema[0], /BIGSERIAL/);
  assert.match(store.schema[0], /p_accounts/);
  assert.match(store.schema[0], /extract\(epoch from now\(\)\)/);
});

test('the whole flow on the SQL store', async () => {
  const store = sqlStore(client());
  await store.migrate();
  const token = await tokenFor('s', 'sqlsite.com');
  const p = createPartners({
    store, secret: 's', niches: ['ai'], siteUrl: 'https://x.test',
    currentUser: () => ({ id: 'u9', name: 'Nine' }),
    fetch: async (url) =>
      String(url).includes('dns')
        ? new Response(JSON.stringify({ Answer: [{ type: 16, data: `"pfs-verify=${token}"` }] }), { status: 200 })
        : new Response('', { status: 404 }),
  });
  const form = (f) => new Request('https://x.test/sell/properties', { method: 'POST', body: new URLSearchParams(f), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

  await p.handle(new Request('https://x.test/sell/apply', { method: 'POST' }));
  const add = await p.handle(form({ domain: 'sqlsite.com' }));
  const id = add.headers.get('location').split('/').pop();
  await p.handle(new Request(`https://x.test/sell/properties/${id}/verify`, { method: 'POST' }));

  const me = await (await p.handle(new Request('https://x.test/sell/me.json'))).json();
  assert.equal(me.rate, 25);
  assert.deepEqual(me.properties, [{ domain: 'sqlsite.com', verified: true, method: 'dns' }]);
  assert.equal((await p.ownerOf('sqlsite.com')).rate, 25);
});
