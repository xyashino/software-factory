import type { z } from 'zod';
import {
  JSONRPC_ERRORS,
  MCP_PROTOCOL_VERSION,
  mcpToolArgumentsSchema,
  mcpToolCallParamsSchema,
  type JsonRpcId,
  type JsonRpcRequest,
} from '@repo/hq-contracts/mcp.contract';
import { BadRequest, Forbidden, isBaseError } from '../core/error-handling';
import type { AuthenticatedContext } from '../core/procedure';
import { mcpTools, toolsFor, type McpTool } from './tools';

const METHODS = [
  'initialize',
  'notifications/initialized',
  'tools/list',
  'tools/call',
] as const;

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId; error: { code: number; message: string } };

type McpMethod = (typeof METHODS)[number];

class RpcFailure extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const isMcpMethod = (method: string): method is McpMethod =>
  (METHODS as readonly string[]).includes(method);

const describeIssue = (error: z.ZodError): string => {
  const issue = error.issues[0];
  const path = (issue?.path ?? []).map(String).join('.');
  return `${path}: ${issue?.message ?? 'invalid value'}`;
};

const toolResult = (payload: object, isError: boolean) => ({
  content: [{ type: 'text', text: JSON.stringify(payload) }],
  structuredContent: payload,
  isError,
});

const initializeResult = () => ({
  protocolVersion: MCP_PROTOCOL_VERSION,
  capabilities: { tools: {} },
  serverInfo: { name: 'hq', version: '0.0.0' },
});

const findTool = (name: string): McpTool => {
  const tool = mcpTools.find((candidate) => candidate.name === name);
  if (tool === undefined)
    throw new RpcFailure(JSONRPC_ERRORS.invalidParams, `Unknown tool: ${name}`);
  return tool;
};

const callTool = async (
  params: unknown,
  ctx: AuthenticatedContext,
): Promise<unknown> => {
  const call = mcpToolCallParamsSchema.safeParse(params);
  if (!call.success)
    throw new RpcFailure(
      JSONRPC_ERRORS.invalidParams,
      `Invalid tool call: ${describeIssue(call.error)}`,
    );
  const tool = findTool(call.data.name);
  if (!ctx.principal.scopes.includes(tool.scope))
    throw new Forbidden(`Token lacks scope: ${tool.scope}`);
  const args = mcpToolArgumentsSchema.safeParse(call.data.arguments ?? {});
  if (!args.success)
    throw new RpcFailure(
      JSONRPC_ERRORS.invalidParams,
      `Invalid tool arguments: ${describeIssue(args.error)}`,
    );
  try {
    const response = await tool.procedure.execute(
      {
        params: args.data.params ?? {},
        query: args.data.query ?? {},
        body: args.data.body,
      },
      ctx,
    );
    return toolResult(response, response.code >= 400);
  } catch (error) {
    if (error instanceof BadRequest)
      throw new RpcFailure(JSONRPC_ERRORS.invalidParams, error.message);
    if (isBaseError(error))
      return toolResult(
        { code: error.status, type: error.type, message: error.message },
        true,
      );
    throw error;
  }
};

const invoke = async (
  method: string,
  params: unknown,
  ctx: AuthenticatedContext,
): Promise<unknown> => {
  if (!isMcpMethod(method))
    throw new RpcFailure(
      JSONRPC_ERRORS.methodNotFound,
      `Method not found: ${method}`,
    );
  switch (method) {
    case 'initialize':
      return initializeResult();
    case 'notifications/initialized':
      return {};
    case 'tools/list':
      return { tools: toolsFor(ctx.principal.scopes) };
    case 'tools/call':
      return callTool(params, ctx);
    default: {
      const exhausted: never = method;
      return exhausted;
    }
  }
};

export const jsonRpcError = (
  id: JsonRpcId,
  code: number,
  message: string,
): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } });

export const dispatchMcp = async (
  message: JsonRpcRequest,
  ctx: AuthenticatedContext,
): Promise<JsonRpcResponse | null> => {
  if (message.id === undefined) return null;
  try {
    const result = await invoke(message.method, message.params, ctx);
    return { jsonrpc: '2.0', id: message.id, result };
  } catch (error) {
    if (error instanceof RpcFailure)
      return jsonRpcError(message.id, error.code, error.message);
    throw error;
  }
};
