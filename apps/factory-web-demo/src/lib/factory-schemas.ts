import { z } from 'zod';

const cellDto = z.object({
  cellId: z.string(),
  projectId: z.string(),
  name: z.string(),
  status: z.string(),
  allowedLines: z.array(z.string()),
  runners: z.array(z.string()),
  activeJobId: z.string().nullable(),
  lastHeartbeatAt: z.number().nullable(),
  leaseExpiresAt: z.number().nullable(),
});

const workOrderDto = z.object({
  orderId: z.string(),
  projectId: z.string(),
  slug: z.string(),
  title: z.string(),
  type: z.string(),
  lineName: z.string(),
  priority: z.string(),
  state: z.string(),
  branch: z.string(),
  staleBase: z.boolean(),
  currentStepIndex: z.number(),
  pinnedCellId: z.string().nullable(),
  activeCellId: z.string().nullable(),
  activeJobId: z.string().nullable(),
  version: z.number(),
  updatedAt: z.number(),
});

const stepDto = z.object({
  stepId: z.string(),
  stepIndex: z.number(),
  stationId: z.string(),
  kind: z.string(),
  state: z.string(),
});

const jobDto = z.object({
  jobId: z.string(),
  kind: z.string(),
  status: z.string(),
  cellId: z.string().nullable(),
});

const workOrderIncidentDto = z.object({
  incidentId: z.string(),
  reason: z.string(),
  status: z.string(),
});

const incidentDto = z.object({
  incidentId: z.string(),
  projectId: z.string(),
  orderId: z.string(),
  failedStepId: z.string().nullable(),
  reason: z.string(),
  detail: z.string(),
  status: z.string(),
  triageOwner: z.string(),
  createdAt: z.number(),
  resolvedAt: z.number().nullable(),
});

const projectDto = z.object({
  projectId: z.string(),
  repoUrl: z.string(),
  defaultBaseBranch: z.string(),
  maxRunning: z.number(),
  updatedAt: z.number(),
});

export const cellsReply = z.object({
  code: z.literal(200),
  cells: z.array(cellDto),
});

export const workOrdersReply = z.object({
  code: z.literal(200),
  items: z.array(workOrderDto),
});

export const workOrderDetailReply = z.object({
  code: z.literal(200),
  order: workOrderDto,
  steps: z.array(stepDto),
  jobs: z.array(jobDto),
  incidents: z.array(workOrderIncidentDto),
});

export const incidentsReply = z.object({
  code: z.literal(200),
  items: z.array(incidentDto),
});

export const projectsReply = z.object({
  code: z.literal(200),
  projects: z.array(projectDto),
});

export const transitionReply = z.object({
  code: z.literal(200),
  order: workOrderDto,
});
