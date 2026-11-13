import { FakeClock } from './fake-clock';
import { FakeStore } from './fake-store';
import { defineStoreContract } from './store.contract';

defineStoreContract('fake', () => {
  const clock = new FakeClock(0);
  return { store: new FakeStore(clock), clock, dispose: () => {} };
});
