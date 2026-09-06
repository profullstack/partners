/**
 * The in-memory store: the reference implementation of the contract, and what
 * the tests run against.
 *
 * The contract every store meets:
 *   getPartner(userId)                    -> partner | null
 *   getPartnerById(id)                    -> partner | null
 *   createPartner({ userId, name })       -> partner
 *   updatePartner(id, patch)              -> partner
 *   listProperties(partnerId)             -> property[]
 *   findProperty(domain)                  -> property | null   (across all partners)
 *   addProperty({ partnerId, domain })    -> property
 *   updateProperty(id, patch)             -> property
 *   removeProperty(id)                    -> void
 *   credit({ partnerId, cents, ref, at }) -> boolean   (false if ref already booked)
 *   earnings(partnerId)                   -> { cents, credits }
 */
export function memoryStore() {
  const partners = new Map();
  const properties = new Map();
  const credits = [];
  let nextPartner = 1;
  let nextProperty = 1;

  const clone = (x) => (x ? { ...x, niches: [...(x.niches ?? [])] } : null);

  return {
    async getPartner(userId) {
      for (const p of partners.values()) if (p.userId === String(userId)) return clone(p);
      return null;
    },
    async getPartnerById(id) {
      return clone(partners.get(String(id)));
    },
    async createPartner({ userId, name }) {
      const id = String(nextPartner++);
      const row = { id, userId: String(userId), name: name ?? null, niches: [], payoutAddress: null, createdAt: Date.now() };
      partners.set(id, row);
      return clone(row);
    },
    async updatePartner(id, patch) {
      const row = partners.get(String(id));
      if (!row) return null;
      Object.assign(row, patch);
      return clone(row);
    },
    async listProperties(partnerId) {
      return [...properties.values()].filter((p) => p.partnerId === String(partnerId)).map((p) => ({ ...p }));
    },
    async findProperty(domain) {
      for (const p of properties.values()) if (p.domain === domain) return { ...p };
      return null;
    },
    async addProperty({ partnerId, domain }) {
      const id = String(nextProperty++);
      const row = { id, partnerId: String(partnerId), domain, verifiedAt: null, method: null, createdAt: Date.now() };
      properties.set(id, row);
      return { ...row };
    },
    async updateProperty(id, patch) {
      const row = properties.get(String(id));
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    },
    async removeProperty(id) {
      properties.delete(String(id));
    },
    async credit({ partnerId, cents, ref, at }) {
      if (ref && credits.some((c) => c.ref === ref)) return false;
      credits.push({ partnerId: String(partnerId), cents: Number(cents) || 0, ref: ref ?? null, at: at ?? Date.now() });
      return true;
    },
    async earnings(partnerId) {
      const mine = credits.filter((c) => c.partnerId === String(partnerId));
      return { cents: mine.reduce((n, c) => n + c.cents, 0), credits: mine.length };
    },
    _dump: () => ({ partners: [...partners.values()], properties: [...properties.values()], credits }),
  };
}
