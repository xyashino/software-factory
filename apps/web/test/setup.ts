import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { workOrdersMediator } from '@/modules/work-orders/core/mediator';
import { clearToasts } from '@/shared/ui/toast';

afterEach(() => {
  cleanup();
  clearToasts();
  workOrdersMediator.reset();
});
