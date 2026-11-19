import type {
  OperatorClientPort,
  OperatorReply,
} from '../../ports/operator-client.port';

export const sendRead = (client: OperatorClientPort): Promise<OperatorReply> =>
  client.send({ verb: 'read' });
