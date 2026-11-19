import type {
  OperatorClientPort,
  OperatorReply,
} from '../../ports/operator-client.port';

export const sendDone = (client: OperatorClientPort): Promise<OperatorReply> =>
  client.send({ verb: 'done' });
