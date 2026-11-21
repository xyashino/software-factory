export type BusEvent = {
  readonly kind: string;
  readonly at: number;
  readonly slotId?: string;
};

export type BusListener = (event: BusEvent) => void;

export type EventBusPort = {
  publish(event: BusEvent): void;
  subscribe(listener: BusListener): () => void;
};
