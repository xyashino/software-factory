import type { HttpAuth } from '@repo/factory-core/contracts/http-routes';
import type { CellId } from '@repo/factory-core/ids';

/** Who holds a verified credential, among the classes the routes accept (PROTOCOL §1). */
export type Caller =
  { kind: 'supervisor'; name: string } | { kind: 'cell'; cellId: CellId };

/**
 * Verifies the bearer token of a route's credential class (PROTOCOL §1). A missing or unknown token
 * refuses with `unauthorized`.
 */
export interface AuthPort {
  authenticate(auth: HttpAuth, token: string | undefined): Promise<Caller>;
}
