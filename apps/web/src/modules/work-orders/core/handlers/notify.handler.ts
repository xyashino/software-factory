import { tap } from 'rxjs';
import { pushToast } from '@/shared/ui/toast';
import { workOrdersBus } from '../bus';

export const notifyEffect$ = workOrdersBus
  .ofType('[EFFECT]_NOTIFY')
  .pipe(tap((payload) => pushToast(payload)));
