import { z } from 'zod';

export const MCP_PROTOCOL_VERSION = '2025-06-18';

export const JSONRPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
} as const;

const jsonRpcIdSchema = z.union([z.string(), z.number(), z.null()]);

export const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: jsonRpcIdSchema.optional(),
  method: z.string(),
  params: z.unknown().optional(),
});

export const mcpToolArgumentsSchema = z.object({
  params: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
});

export const mcpToolCallParamsSchema = z.object({
  name: z.string().min(1),
  arguments: mcpToolArgumentsSchema.optional(),
});

export type JsonRpcId = z.infer<typeof jsonRpcIdSchema>;
export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;
