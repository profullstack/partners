import type { Ladder } from '@profullstack/leaderboard';

export interface Partner {
  id: string;
  userId: string;
  name: string | null;
  niches: string[];
  payoutAddress: string | null;
  createdAt: number;
}

export interface Property {
  id: string;
  partnerId: string;
  domain: string;
  /** Epoch millis, or null while unproven. Only verified properties count. */
  verifiedAt: number | null;
  method: 'dns' | 'file' | null;
  createdAt: number;
}

export interface Earnings { cents: number; credits: number }

export interface Store {
  getPartner(userId: string): Promise<Partner | null>;
  getPartnerById(id: string): Promise<Partner | null>;
  createPartner(x: { userId: string; name?: string | null }): Promise<Partner>;
  updatePartner(id: string, patch: Partial<Pick<Partner, 'name' | 'niches' | 'payoutAddress'>>): Promise<Partner | null>;
  listProperties(partnerId: string): Promise<Property[]>;
  findProperty(domain: string): Promise<Property | null>;
  addProperty(x: { partnerId: string; domain: string }): Promise<Property>;
  updateProperty(id: string, patch: Partial<Pick<Property, 'verifiedAt' | 'method'>>): Promise<Property | null>;
  removeProperty(id: string): Promise<void>;
  /** False when `ref` was already booked. */
  credit(x: { partnerId: string; cents: number; ref?: string | null; at?: number }): Promise<boolean>;
  earnings(partnerId: string): Promise<Earnings>;
}

export function memoryStore(): Store & { _dump(): unknown };

export interface SqlStoreOptions {
  execute: (q: { sql: string; args: unknown[] }) => Promise<{ rows: Record<string, unknown>[] }> | { rows: Record<string, unknown>[] };
  prefix?: string;
  dialect?: 'sqlite' | 'postgres';
}
export function sqlStore(o: SqlStoreOptions): Store & { schema: string[]; tables: Record<string, string>; migrate(): Promise<void> };

export interface HostUser { id: string; name?: string | null; email?: string | null }

export interface PartnersOptions {
  store?: Store;
  basePath?: string;
  siteName?: string;
  siteUrl?: string;
  /** Required: verification tokens are derived from it. */
  secret: string;
  currentUser?: (request: Request) => Promise<HostUser | null> | HostUser | null;
  loginUrl?: string;
  niches?: string[];
  ladder?: Ladder;
  prefix?: string;
  maxProperties?: number;
  fetch?: typeof fetch;
  stats?: { crawlerShare?: string; topAgent?: string } | (() => Promise<{ crawlerShare?: string; topAgent?: string } | null>);
  onApply?: (x: { partner: Partner; user: HostUser }) => void | Promise<void>;
  onVerified?: (x: { partner: Partner; domain: string; method: string }) => void | Promise<void>;
}

export interface Program {
  handle(request: Request): Promise<Response | null>;
  credit(x: { partnerId: string; cents: number; ref?: string | null; at?: number }): Promise<boolean>;
  /** The verified owner of a domain, with the rate to split at, or null. */
  ownerOf(domain: string): Promise<{ partner: Partner; property: Property; rate: number } | null>;
  rateFor(partner: Partner, properties: Property[]): number;
  ladder: Ladder;
  basePath: string;
  niches: string[];
  middleware(): (c: any, next: () => Promise<void>) => Promise<Response | void>;
}

export function createPartners(options: PartnersOptions): Program;

export function normaliseDomain(input: unknown): string | null;
export function tokenFor(secret: string, domain: string): Promise<string>;
export function instructionsFor(x: { secret: string; domain: string; prefix?: string }): Promise<{
  domain: string; token: string;
  dns: { type: string; host: string; value: string };
  file: { url: string; contents: string };
}>;
export function checkDomain(x: { secret: string; domain: string; prefix?: string; fetch?: typeof fetch; timeoutMs?: number }): Promise<{
  ok: boolean; method: 'dns' | 'file' | null; token: string; reason?: string;
}>;
export { commissionLadder } from '@profullstack/leaderboard';

/** Hono middleware. */
export function partners(programOrOptions: Program | PartnersOptions): (c: any, next: () => Promise<void>) => Promise<Response | void>;
/** Next.js route handlers for `app/<base>/[[...path]]/route.js`. */
export function partnersRoute(programOrOptions: Program | PartnersOptions): {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
  HEAD: (request: Request) => Promise<Response>;
};
