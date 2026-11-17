export const ENTITY_TYPES = [
  'order_plan',
  'work_order',
  'order_step',
  'job',
  'incident',
  'cell',
] as const;

export const ACTOR_KINDS = [
  'supervisor',
  'mechanic',
  'cell',
  'system',
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export type ActorKind = (typeof ACTOR_KINDS)[number];

export interface StateTransitionInput {
  projectId: string;
  entityType: EntityType;
  entityId: string;
  fromState: string | null;
  toState: string;
  actorKind: ActorKind;
  actorId: string | null;
  commandId: string | null;
  meta: Record<string, unknown> | null;
  at: number;
}

export interface StateTransitionRecord extends StateTransitionInput {
  seq: number;
}
