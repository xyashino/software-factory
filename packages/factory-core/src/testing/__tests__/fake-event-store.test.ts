import { describe, it } from 'vitest';
import { fakeEventStore } from '../fake-event-store';
import { defineEventStoreContract } from '../store-contract';

defineEventStoreContract({ describe, it }, 'in-memory fake', async () => {
  const store = fakeEventStore();
  return {
    store,
    seedProject: async () => undefined,
    orders: () => store.orders(),
    close: async () => undefined,
  };
});
