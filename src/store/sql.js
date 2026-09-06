/**
 * A store over any SQL client with `execute({ sql, args }) -> { rows }`.
 * Same shape as @profullstack/leaderboard's, so a site that already wired one
 * up passes the same adapter here.
 *
 * `dialect: 'postgres'` rewrites `?` to `$n` and picks Postgres types; the
 * default is SQLite/libSQL. Four tables, created by `migrate()` or by running
 * `schema` through your own migration tool.
 */
export function sqlStore({ execute, prefix = 'partner_', dialect = 'sqlite' } = {}) {
  if (typeof execute !== 'function') throw new TypeError('sqlStore needs an execute({ sql, args }) function');
  const T = { partners: `${prefix}accounts`, properties: `${prefix}properties`, credits: `${prefix}credits` };
  const pg = dialect === 'postgres';
  const q = (sql) => {
    if (!pg) return sql;
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  };
  const run = (sql, args = []) => execute({ sql: q(sql), args });
  const rows = async (sql, args) => (await run(sql, args))?.rows ?? [];
  const id = pg ? 'BIGSERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const now = pg ? 'extract(epoch from now()) * 1000' : "CAST(strftime('%s','now') AS INTEGER) * 1000";

  const schema = [
    `CREATE TABLE IF NOT EXISTS ${T.partners} (
       id ${id},
       user_id TEXT NOT NULL UNIQUE,
       name TEXT,
       niches TEXT NOT NULL DEFAULT '',
       payout_address TEXT,
       created_at BIGINT NOT NULL DEFAULT (${now}))`,
    `CREATE TABLE IF NOT EXISTS ${T.properties} (
       id ${id},
       partner_id TEXT NOT NULL,
       domain TEXT NOT NULL UNIQUE,
       verified_at BIGINT,
       method TEXT,
       created_at BIGINT NOT NULL DEFAULT (${now}))`,
    `CREATE INDEX IF NOT EXISTS ${T.properties}_partner ON ${T.properties} (partner_id)`,
    `CREATE TABLE IF NOT EXISTS ${T.credits} (
       id ${id},
       partner_id TEXT NOT NULL,
       cents BIGINT NOT NULL,
       ref TEXT UNIQUE,
       at BIGINT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS ${T.credits}_partner ON ${T.credits} (partner_id)`,
  ];

  const toPartner = (r) =>
    r && {
      id: String(r.id),
      userId: String(r.user_id),
      name: r.name ?? null,
      niches: String(r.niches ?? '').split(',').filter(Boolean),
      payoutAddress: r.payout_address ?? null,
      createdAt: Number(r.created_at),
    };
  const toProperty = (r) =>
    r && {
      id: String(r.id),
      partnerId: String(r.partner_id),
      domain: String(r.domain),
      verifiedAt: r.verified_at == null ? null : Number(r.verified_at),
      method: r.method ?? null,
      createdAt: Number(r.created_at),
    };

  return {
    schema,
    tables: T,
    async migrate() {
      for (const sql of schema) await run(sql);
    },
    async getPartner(userId) {
      return toPartner((await rows(`SELECT * FROM ${T.partners} WHERE user_id = ?`, [String(userId)]))[0]) ?? null;
    },
    async getPartnerById(id) {
      return toPartner((await rows(`SELECT * FROM ${T.partners} WHERE id = ?`, [String(id)]))[0]) ?? null;
    },
    async createPartner({ userId, name }) {
      await run(`INSERT INTO ${T.partners} (user_id, name, niches) VALUES (?, ?, '')`, [String(userId), name ?? null]);
      return this.getPartner(userId);
    },
    async updatePartner(id, patch) {
      const sets = [];
      const args = [];
      if ('name' in patch) { sets.push('name = ?'); args.push(patch.name ?? null); }
      if ('niches' in patch) { sets.push('niches = ?'); args.push((patch.niches ?? []).join(',')); }
      if ('payoutAddress' in patch) { sets.push('payout_address = ?'); args.push(patch.payoutAddress ?? null); }
      if (!sets.length) return this.getPartnerById(id);
      args.push(String(id));
      await run(`UPDATE ${T.partners} SET ${sets.join(', ')} WHERE id = ?`, args);
      return this.getPartnerById(id);
    },
    async listProperties(partnerId) {
      return (await rows(`SELECT * FROM ${T.properties} WHERE partner_id = ? ORDER BY id`, [String(partnerId)])).map(toProperty);
    },
    async findProperty(domain) {
      return toProperty((await rows(`SELECT * FROM ${T.properties} WHERE domain = ?`, [String(domain)]))[0]) ?? null;
    },
    async addProperty({ partnerId, domain }) {
      await run(`INSERT INTO ${T.properties} (partner_id, domain) VALUES (?, ?)`, [String(partnerId), String(domain)]);
      return this.findProperty(domain);
    },
    async updateProperty(id, patch) {
      const sets = [];
      const args = [];
      if ('verifiedAt' in patch) { sets.push('verified_at = ?'); args.push(patch.verifiedAt ?? null); }
      if ('method' in patch) { sets.push('method = ?'); args.push(patch.method ?? null); }
      if (!sets.length) return null;
      args.push(String(id));
      await run(`UPDATE ${T.properties} SET ${sets.join(', ')} WHERE id = ?`, args);
      return toProperty((await rows(`SELECT * FROM ${T.properties} WHERE id = ?`, [String(id)]))[0]) ?? null;
    },
    async removeProperty(id) {
      await run(`DELETE FROM ${T.properties} WHERE id = ?`, [String(id)]);
    },
    async credit({ partnerId, cents, ref, at }) {
      const when = Number(at ?? Date.now());
      if (ref) {
        const seen = await rows(`SELECT 1 AS one FROM ${T.credits} WHERE ref = ?`, [String(ref)]);
        if (seen.length) return false;
      }
      await run(`INSERT INTO ${T.credits} (partner_id, cents, ref, at) VALUES (?, ?, ?, ?)`, [
        String(partnerId), Number(cents) || 0, ref ?? null, when,
      ]);
      return true;
    },
    async earnings(partnerId) {
      const r = (await rows(`SELECT COUNT(*) AS n, COALESCE(SUM(cents), 0) AS total FROM ${T.credits} WHERE partner_id = ?`, [String(partnerId)]))[0];
      return { cents: Number(r?.total ?? 0), credits: Number(r?.n ?? 0) };
    },
  };
}
