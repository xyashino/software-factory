import { z } from 'zod';
import { FactoryUnavailable } from './factory-error';
import {
  factoriesReply,
  incidentsReply,
  transitionReply,
  workOrderDetailReply,
  workOrdersReply,
} from './factory-schemas';

const REQUEST_TIMEOUT_MS = 5_000;
const HTTP_BAD_GATEWAY = 502;

const errorBodySchema = z.object({
  type: z.string(),
  message: z.string().optional(),
});

export type FactoryClientOptions = {
  baseUrl: string;
  getToken: () => string;
};

export type WorkOrderFilter = {
  projectId: string;
  planId?: string;
  lineName?: string;
  state?: string;
  pinnedFactoryId?: string;
};

export type IncidentFilter = {
  projectId: string;
  orderId?: string;
  reason?: string;
  status?: string;
};

const toQuery = (filter: Record<string, string | undefined>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined) params.set(key, value);
  }
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
};

const readErrorBody = async (
  response: Response,
): Promise<z.infer<typeof errorBodySchema> | undefined> => {
  const parsed = errorBodySchema.safeParse(
    await response.json().catch(() => null),
  );
  return parsed.success ? parsed.data : undefined;
};

const request = async <Schema extends z.ZodType>(
  options: FactoryClientOptions,
  method: 'GET' | 'POST',
  path: string,
  schema: Schema,
  body?: object,
): Promise<z.output<Schema>> => {
  const headers: Record<string, string> = {
    authorization: `Bearer ${options.getToken()}`,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(new URL(path, options.baseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new FactoryUnavailable(0);
  }

  if (!response.ok) {
    const body = await readErrorBody(response);
    throw new FactoryUnavailable(response.status, body?.type, body?.message);
  }

  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new FactoryUnavailable(HTTP_BAD_GATEWAY);
  return parsed.data;
};

export const createFactoryClient = (options: FactoryClientOptions) => {
  const get = <Schema extends z.ZodType>(path: string, schema: Schema) =>
    request(options, 'GET', path, schema);

  return {
    listFactories: () => get('/api/v1/factories', factoriesReply),
    listWorkOrders: (filter: WorkOrderFilter) =>
      get(`/api/v1/work-orders${toQuery(filter)}`, workOrdersReply),
    getWorkOrder: (id: string) =>
      get(
        `/api/v1/work-orders/${encodeURIComponent(id)}`,
        workOrderDetailReply,
      ),
    listIncidents: (filter: IncidentFilter) =>
      get(`/api/v1/incidents${toQuery(filter)}`, incidentsReply),
    transitionWorkOrder: (id: string, action: string) =>
      request(
        options,
        'POST',
        `/api/v1/work-orders/${encodeURIComponent(id)}/transitions`,
        transitionReply,
        { action },
      ),
  };
};
