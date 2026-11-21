import { Unreachable } from '../../application/core/errors';
import type {
  OperatorClientPort,
  OperatorReply,
  OperatorVerbFields,
} from '../../application/ports/operator-client.port';

const REQUEST_TIMEOUT_MS = 10_000;

export interface OperatorClientOptions {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
}

const parseReply = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Unreachable('the Cell sent a reply this CLI cannot read');
  }
};

const readText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    throw new Unreachable('the Cell sent a reply this CLI cannot read');
  }
};

// One request, no retry: the agent decides whether to send again.
export const createOperatorClient = ({
  url,
  token,
  fetchImpl = fetch,
}: OperatorClientOptions): OperatorClientPort => ({
  send: async (verb: OperatorVerbFields): Promise<OperatorReply> => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...verb, token }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Unreachable(`cannot reach the Cell at ${url}`);
    }
    return {
      status: response.status,
      body: parseReply(await readText(response)),
    };
  },
});
