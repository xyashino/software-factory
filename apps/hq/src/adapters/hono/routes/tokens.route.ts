import { Hono } from 'hono';
import { honoAdapter } from '../adapter';
import type { AppEnv } from '../types';
import { issueTokenProcedure } from '../../../application/procedures/tokens/issue-token.procedure';
import { joinTokenProcedure } from '../../../application/procedures/tokens/join-token.procedure';
import { revokeTokenProcedure } from '../../../application/procedures/tokens/revoke-token.procedure';
import { rotateTokenProcedure } from '../../../application/procedures/tokens/rotate-token.procedure';

export const tokensRoute = new Hono<AppEnv>()
  .post('/', honoAdapter(issueTokenProcedure))
  .post('/rotate', honoAdapter(rotateTokenProcedure))
  .post('/join', honoAdapter(joinTokenProcedure))
  .delete('/:id', honoAdapter(revokeTokenProcedure));
