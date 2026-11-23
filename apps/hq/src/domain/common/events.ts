import { ACTOR_KINDS, ENTITY_TYPES } from '@repo/hq-contracts/enums/events';
import type { CommandId, ProjectId } from './brand';

export type EntityType = (typeof ENTITY_TYPES)[number];

export type ActorKind = (typeof ACTOR_KINDS)[number];

export interface StateTransitionInput {
  projectId: ProjectId;
  entityType: EntityType;
  entityId: string;
  fromState: string | null;
  toState: string;
  actorKind: ActorKind;
  actorId: string | null;
  commandId: CommandId | null;
  meta: Record<string, unknown> | null;
  at: number;
}

export interface StateTransitionRecord extends StateTransitionInput {
  seq: number;
}
