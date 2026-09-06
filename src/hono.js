import { createPartners } from './index.js';

/**
 * The partner program as Hono middleware.
 *
 *   import { partners } from '@profullstack/partners/hono';
 *   app.use('*', partners(program));
 *
 * Mount it after whatever populates the session, since `currentUser` reads it.
 */
export function partners(programOrOptions) {
  const program =
    programOrOptions && typeof programOrOptions.handle === 'function' ? programOrOptions : createPartners(programOrOptions);
  return async (c, next) => {
    const answer = await program.handle(c.req.raw);
    if (answer) return answer;
    await next();
  };
}
