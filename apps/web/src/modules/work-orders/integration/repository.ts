import {
  getWorkOrderContract,
  listWorkOrdersContract,
  transitionWorkOrderContract,
} from '@repo/hq-contracts/work-orders.contract';
import { z } from 'zod';
import type {
  WorkOrder,
  WorkOrderAction,
  WorkOrderDetail,
  WorkOrderError,
  WorkOrderFilterState,
} from '../domain/models';
import { mapWorkOrder, mapWorkOrderDetail } from './mappers';

const errorSchema = z.object({
  code: z.number().optional(),
  type: z.string().optional(),
  message: z.string().optional(),
});

export class WorkOrdersApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'WorkOrdersApiError';
    this.code = code;
  }
}

const parseErrorResponse = async (
  response: Response,
): Promise<WorkOrdersApiError> => {
  const parsed = errorSchema.safeParse(await response.json().catch(() => null));
  const code = parsed.success
    ? (parsed.data.type ?? `HTTP_${String(response.status)}`)
    : `HTTP_${String(response.status)}`;
  const message =
    parsed.success && parsed.data.message
      ? parsed.data.message
      : `Request failed with status ${String(response.status)}`;
  return new WorkOrdersApiError(code, message);
};

const requestJson = async <TSchema extends z.ZodType>(
  input: string,
  schema: TSchema,
  init?: RequestInit,
): Promise<z.output<TSchema>> => {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new WorkOrdersApiError(
      'NETWORK_ERROR',
      'Unable to reach the web BFF server. Check your connection and retry.',
    );
  }

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new WorkOrdersApiError(
      'INVALID_RESPONSE',
      'Received an unexpected response shape from HQ.',
    );
  }
  return parsed.data;
};

export const toWorkOrderError = (error: unknown): WorkOrderError => {
  if (error instanceof WorkOrdersApiError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: 'UNEXPECTED_ERROR', message: error.message };
  }
  return { code: 'UNEXPECTED_ERROR', message: 'Unexpected error occurred.' };
};

export const listWorkOrders = async (
  filter: WorkOrderFilterState,
): Promise<WorkOrder[]> => {
  const query = filter === 'all' ? '' : `?state=${encodeURIComponent(filter)}`;
  const data = await requestJson(
    `/api/work-orders${query}`,
    listWorkOrdersContract.out[200],
  );
  return data.items.map(mapWorkOrder);
};

export const getWorkOrderDetail = async (
  orderId: string,
): Promise<WorkOrderDetail> => {
  const data = await requestJson(
    `/api/work-orders/${encodeURIComponent(orderId)}`,
    getWorkOrderContract.out[200],
  );
  return mapWorkOrderDetail(data);
};

export const transitionWorkOrder = async (
  orderId: string,
  action: WorkOrderAction,
): Promise<WorkOrder> => {
  const data = await requestJson(
    `/api/work-orders/${encodeURIComponent(orderId)}/transitions`,
    transitionWorkOrderContract.out[200],
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    },
  );
  return mapWorkOrder(data.order);
};
