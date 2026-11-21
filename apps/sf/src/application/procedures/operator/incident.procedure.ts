import type {
  OperatorClientPort,
  OperatorReply,
  OperatorVerbFields,
} from '../../ports/operator-client.port';

export type IncidentFields = Extract<OperatorVerbFields, { verb: 'incident' }>;

export const sendIncident = (
  client: OperatorClientPort,
  fields: Omit<IncidentFields, 'verb'>,
): Promise<OperatorReply> => client.send({ verb: 'incident', ...fields });
