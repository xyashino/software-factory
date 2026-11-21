import type {
  OperatorClientPort,
  OperatorReply,
} from '../../ports/operator-client.port';

export const sendVerdictPass = (
  client: OperatorClientPort,
): Promise<OperatorReply> => client.send({ verb: 'verdict', outcome: 'pass' });

export const sendVerdictFail = (
  client: OperatorClientPort,
  feedback: string,
): Promise<OperatorReply> =>
  client.send({ verb: 'verdict', outcome: 'fail', feedback });
