import type {
  OperatorClientPort,
  OperatorReply,
} from '../../ports/operator-client.port';

export const sendBlock = (
  client: OperatorClientPort,
  reason: string,
  handover: string,
): Promise<OperatorReply> => client.send({ verb: 'block', reason, handover });
