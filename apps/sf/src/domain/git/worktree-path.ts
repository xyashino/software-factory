import { WORKTREES_DIR } from '../../config';
import { joinPath } from '../common/path';
import { slugOf } from './branch-names';

export const worktreeRelOf = (orderId: string | null): string =>
  joinPath(WORKTREES_DIR, slugOf(orderId));
