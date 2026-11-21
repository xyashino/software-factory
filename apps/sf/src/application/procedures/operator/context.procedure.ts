import type {
  OperatorClientPort,
  OperatorReply,
} from '../../ports/operator-client.port';

export const sendContext = (
  client: OperatorClientPort,
): Promise<OperatorReply> => client.send({ verb: 'context' });
