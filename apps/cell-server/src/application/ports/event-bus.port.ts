export type BusEvent = { readonly kind: string; readonly at: number };

export type BusListener = (event: BusEvent) => void;

export type EventBusPort = {
  publish(event: BusEvent): void;
  subscribe(listener: BusListener): () => void;
};
