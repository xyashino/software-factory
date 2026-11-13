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

export const stationSchema = z
  .object({
    id: stationIdSchema,
    kind: z.enum(['operator', 'inspection']),
    runner: tag.optional(),
    requires: z.array(tag).max(32),
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
