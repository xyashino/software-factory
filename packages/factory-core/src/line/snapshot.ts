import { z } from 'zod';
import { type StationId, stationIdSchema } from '../ids';
import {
  isMachineIndependentId,
  isMachineIndependentText,
} from '../machine-local';

const TAG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ARTIFACT_KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const tag = z
  .string()
  .regex(TAG)
  .refine(isMachineIndependentId, 'tag must not name a machine-local value');

const machineText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      isMachineIndependentText,
      'value must not contain machine-local values',
    );

/** The Operator pool an operator Station runs with (CORE §11): its profile, runner, model and limits. */
export const operatorPoolSchema = z
  .object({
    profile: tag,
    runner: tag,
    model: machineText(128),
    permission: z.enum(['read', 'write']),
    headless: z.boolean(),
    timeoutMs: z.number().int().min(1),
  })
  .strict();

/** A timed list of shell commands: a workspace's `sync` or `setup` (PROTOCOL §4). */
export const commandBlockSchema = z
  .object({
    timeoutMs: z.number().int().min(1),
    exec: z.array(machineText(512)).max(32),
  })
  .strict();

export const stationSchema = z
  .object({
    id: stationIdSchema,
    kind: z.enum(['operator', 'inspection']),
    // Execution details the Cell needs to run the Station (PROTOCOL §4). Optional for snapshots pinned before
    // they were carried; a job that needs one of them and finds none is refused, never guessed.
    operator: operatorPoolSchema.optional(),
    timeoutMs: z.number().int().min(1).optional(),
    runner: tag.optional(),
    onFail: z
      .object({ retry: stationIdSchema, max: z.number().int().min(0).max(100) })
      .strict()
      .optional(),
    maxRestarts: z.number().int().min(0).max(100),
    maxLostRestarts: z.number().int().min(0).max(100),
    // Optional and additive (CORE §11). `verdict`: an Operator whose pass is a judgment (PROTOCOL §4).
    verdict: z.boolean().optional(),
    // Keys of the artifacts the Station must hand over when its Cycle completes.
    artifacts: z
      .array(
        z
          .string()
          .regex(ARTIFACT_KEY)
          .refine(
            isMachineIndependentId,
            'key must not name a machine-local value',
          ),
      )
      .max(32)
      .default([]),
    // Map of artifact key -> relative file name declared in operator profile.
    artifactFiles: z.record(z.string(), z.string()).optional(),
    // Shell commands of an Inspection, run in order (PROTOCOL §4 `exec`).
    exec: z
      .array(
        z
          .string()
          .min(1)
          .max(512)
          .refine(
            isMachineIndependentText,
            'command must not contain machine-local values',
          ),
      )
      .max(32)
      .optional(),
  })
  .strict();

export const lineSnapshotSchema = z
  .object({
    snapshotVersion: z.literal(1),
    name: tag,
    hash: z.string().regex(SHA256),
    stations: z.array(stationSchema).min(1).max(64),
    // Per-job workspace preparation, and the artifacts a delivery commits and reports (`<stationId>.<key>`).
    workspace: z
      .object({
        sync: commandBlockSchema.optional(),
        setup: commandBlockSchema.optional(),
      })
      .strict()
      .optional(),
    deliver: z
      .object({ commit: machineText(128), report: machineText(128) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((line, ctx) => {
    const ids = new Set(line.stations.map((station) => station.id));
    // Only an operator's Cycle commits work, so a Line without one has no checkpoint to deliver from.
    if (!line.stations.some((station) => station.kind === 'operator')) {
      ctx.addIssue({
        code: 'custom',
        message: 'a line needs at least one operator station',
        path: ['stations'],
      });
    }
    if (ids.size !== line.stations.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'station ids must be unique',
        path: ['stations'],
      });
    }
    line.stations.forEach((station, index) => {
      if (station.onFail && !ids.has(station.onFail.retry)) {
        ctx.addIssue({
          code: 'custom',
          message: `onFail.retry ${station.onFail.retry} names no station`,
          path: ['stations', index, 'onFail', 'retry'],
        });
      }
    });
  });

export type Station = z.infer<typeof stationSchema>;
export type LineSnapshot = z.infer<typeof lineSnapshotSchema>;

/** Position of a Station in the Line, undefined when the Line has no such Station. */
export const stationIndex = (
  line: LineSnapshot,
  id: StationId,
): number | undefined => {
  const index = line.stations.findIndex((station) => station.id === id);
  return index < 0 ? undefined : index;
};

/** The Station at a position, undefined past either end. */
export const stationAt = (
  line: LineSnapshot,
  index: number,
): Station | undefined =>
  Number.isInteger(index) && index >= 0 ? line.stations[index] : undefined;

export const findStation = (
  line: LineSnapshot,
  id: StationId,
): Station | undefined => line.stations.find((station) => station.id === id);
