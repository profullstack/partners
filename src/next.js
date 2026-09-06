import { createPartners } from './index.js';

/**
 * Route handlers for Next.js. Mount on a catch-all under the base path:
 *
 *   // app/sell/[[...path]]/route.js
 *   import { partnersRoute } from '@profullstack/partners/next';
 *   export const { GET, POST } = partnersRoute(program);
 *   export const dynamic = 'force-dynamic';
 *
 * The base path itself needs no second route here, unlike a JSON sibling: every
 * path this program answers lives under `<base>` or is `<base>` exactly, and
 * an optional catch-all matches both.
 */
export function partnersRoute(programOrOptions) {
  const program =
    programOrOptions && typeof programOrOptions.handle === 'function' ? programOrOptions : createPartners(programOrOptions);
  const handler = async (request) => (await program.handle(request)) ?? new Response('Not found', { status: 404 });
  return { GET: handler, POST: handler, HEAD: handler };
}
