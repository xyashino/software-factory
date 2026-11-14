import { describe, expect, it } from 'vitest';
import { orderIdOf, projectIdSchema, todoIdSchema } from '../../ids';
import type { OrderEvent } from '../events';
import type { Next } from '../next';
import {
  type ProjectionMeta,
  WORKSPACE_COOLDOWN_MS,
  toProjection,
} from '../projection';
import type { WorkOrderState } from '../state';
import {
  ORDER_ID,
  andonRaised,
  cellIdOf,
  commitOf,
  created,
  cycleCompleted,
  cycleIdOf,
  cycleStarted,
  deliveryFinished,
  fold,
  history,
  jobClaimed,
  jobIdOf,
  prStateChanged,
  resumeIdOf,
  resumed,
  stationOf,
  workspaceFailed,
} from './builders';

const foldEvents = (...events: OrderEvent[]): WorkOrderState =>
  fold(history(...events));

const claimDelivery = (n: number) =>
  jobClaimed({
    jobId: jobIdOf(n),
    kind: 'deliver',
    cellId: cellIdOf(1),
    epoch: n,
    cycleId: undefined,
  });

const META: ProjectionMeta = {
  lastSeq: 7,
  createdAt: 1000,
  updatedAt: 9000,
  next: { kind: 'busy' },
};

const buildJob: Next = {
  kind: 'job',
  job: {
    kind: 'run_operator_station',
    stationId: stationOf('build'),
    n: 1,
    cause: { kind: 'first' },
    base: commitOf(1),
  },
};

const claim = (n: number, cellN = 1) =>
  jobClaimed({
    jobId: jobIdOf(n),
    cycleId: cycleIdOf(n),
    cellId: cellIdOf(cellN),
    epoch: n,
  });
const start = (n: number, station: string) =>
  cycleStarted({
    cycleId: cycleIdOf(n),
    jobId: jobIdOf(n),
    stationId: stationOf(station),
    n: 1,
    cause: { kind: 'first' },
    baseCommit: commitOf(n),
  });
const passed = (n: number, station: string) => [
  claim(n),
  start(n, station),
  cycleCompleted({ cycleId: cycleIdOf(n), commit: commitOf(n), artifacts: {} }),
];

/** A Work order whose plan Station passed and whose build Station is running on cell 1. */
const building = (): WorkOrderState =>
  foldEvents(created(), ...passed(1, 'plan'), claim(2), start(2, 'build'));

describe('toProjection: orders columns (STORAGE §4)', () => {
  it('order_id is the Work order id', () => {
    expect(toProjection(building(), META).orderId).toBe(ORDER_ID);
  });

  it('project_id is the project of the Work order', () => {
    expect(toProjection(building(), META).projectId).toBe('software-factory');
  });

  it('todo_id is the todo of the Work order', () => {
    expect(toProjection(building(), META).todoId).toBe('v2-02-demo');
  });

  it('title is the spec title', () => {
    expect(toProjection(building(), META).title).toBe('Add the core model');
  });

  it('line is the name of the pinned Line', () => {
    expect(toProjection(building(), META).line).toBe('factory-default');
  });

  it('priority is the priority of the Work order', () => {
    expect(toProjection(building(), META).priority).toBe('medium');
  });

  it('depends_on lists the Work orders it waits for', () => {
    const dependency = orderIdOf(
      projectIdSchema.parse('software-factory'),
      todoIdSchema.parse('v2-01-core-ids'),
    );
    const state = foldEvents(created({ dependsOn: [dependency] }));
    expect(toProjection(state, META).dependsOn).toEqual([
      'software-factory:v2-01-core-ids',
    ]);
  });

  it('last_seq is the seq the caller folded to', () => {
    expect(toProjection(building(), META).lastSeq).toBe(7);
  });

  it('status is the board status of the Work order', () => {
    expect(toProjection(building(), META).status).toBe('running');
  });

  it('holder is the kind of the holder of the Work order', () => {
    expect(toProjection(building(), META).holder).toBe('cell');
  });

  it('next_kind is the kind of the next step', () => {
    expect(toProjection(building(), { ...META, next: buildJob }).nextKind).toBe(
      'job',
    );
  });

  it('job_kind is the kind of the next job', () => {
    expect(toProjection(building(), { ...META, next: buildJob }).jobKind).toBe(
      'run_operator_station',
    );
  });

  it('job_kind is absent when the next step is not a job', () => {
    expect(toProjection(building(), META).jobKind).toBeNull();
  });

  it('runner is the runner of the Station the next job runs', () => {
    expect(toProjection(building(), { ...META, next: buildJob }).runner).toBe(
      'claude',
    );
  });

  it('runner is absent when the next job is an inspection', () => {
    const next: Next = {
      kind: 'job',
      job: {
        kind: 'run_inspection',
        stationId: stationOf('check'),
        n: 1,
        cause: { kind: 'first' },
        base: 'branch_base',
      },
    };
    expect(toProjection(building(), { ...META, next }).runner).toBeNull();
  });

  it('required_capabilities are the requires tags of the next Station', () => {
    expect(
      toProjection(building(), { ...META, next: buildJob })
        .requiredCapabilities,
    ).toEqual(['docker']);
  });

  it('station_id is the Station of the next job', () => {
    expect(
      toProjection(building(), { ...META, next: buildJob }).stationId,
    ).toBe('build');
  });

  it('station_id falls back to the Station the phase points at when no job names one', () => {
    expect(toProjection(building(), META).stationId).toBe('build');
  });

  it('station_index is the position of the Station in the Line', () => {
    expect(
      toProjection(building(), { ...META, next: buildJob }).stationIndex,
    ).toBe(1);
  });

  it('progressed is false until a Station passed', () => {
    expect(
      toProjection(foldEvents(created(), claim(1), start(1, 'plan')), META)
        .progressed,
    ).toBe(false);
  });

  it('progressed is true once a Station passed', () => {
    expect(toProjection(building(), META).progressed).toBe(true);
  });

  it('resumed mirrors the resume wait', () => {
    expect(toProjection(building(), META).resumed).toBe(false);
    const waiting = foldEvents(
      created(),
      andonRaised({ reason: 'no_retry' }),
      resumed({ resumeId: resumeIdOf(1), mode: { kind: 'retry_station' } }),
    );
    expect(toProjection(waiting, META).resumed).toBe(true);
  });

  it('last_cell_id is the cell of the latest Cycle', () => {
    expect(toProjection(building(), META).lastCellId).toBe(cellIdOf(1));
  });

  it('last_cell_id falls back to the last workspace failure when no Cycle ran', () => {
    const state = foldEvents(
      created(),
      claim(1, 4),
      workspaceFailed({ jobId: jobIdOf(1) }),
    );
    expect(toProjection(state, META).lastCellId).toBe(cellIdOf(4));
  });

  it('last_cell_id is absent for a fresh Work order', () => {
    expect(toProjection(foldEvents(created()), META).lastCellId).toBeNull();
  });

  it('avoid_cells keeps a workspace-failed cell out until the cooldown ends', () => {
    const state = foldEvents(
      created(),
      claim(1, 4),
      workspaceFailed({ jobId: jobIdOf(1) }),
    );
    expect(toProjection(state, META).avoidCells).toEqual([
      { cellId: cellIdOf(4), until: 3000 + WORKSPACE_COOLDOWN_MS },
    ]);
  });

  it('avoid_cells lists a cell once, with the latest cooldown, when it failed twice', () => {
    const state = foldEvents(
      created(),
      claim(1, 4),
      workspaceFailed({ jobId: jobIdOf(1) }),
      claim(2, 4),
      workspaceFailed({ jobId: jobIdOf(2) }),
    );
    expect(toProjection(state, META).avoidCells).toEqual([
      { cellId: cellIdOf(4), until: 5000 + WORKSPACE_COOLDOWN_MS },
    ]);
  });

  it('avoid_cells is empty when no workspace failed', () => {
    expect(toProjection(building(), META).avoidCells).toEqual([]);
  });

  it('andon_reason is the reason of the open Andon', () => {
    const state = foldEvents(
      created(),
      andonRaised({ reason: 'delivery_failed' }),
    );
    expect(toProjection(state, META).andonReason).toBe('delivery_failed');
  });

  it('andon_reason is absent without an Andon', () => {
    expect(toProjection(building(), META).andonReason).toBeNull();
  });

  it('pr_url is the pull request of the delivery', () => {
    const state = foldEvents(
      created(),
      ...passed(1, 'plan'),
      claimDelivery(9),
      deliveryFinished({ jobId: jobIdOf(9), commit: commitOf(9) }),
    );
    expect(toProjection(state, META).prUrl).toBe(
      'https://github.com/example/software-factory/pull/42',
    );
  });

  it('pr_state is the state of the pull request', () => {
    const state = foldEvents(
      created(),
      ...passed(1, 'plan'),
      claimDelivery(9),
      deliveryFinished({ jobId: jobIdOf(9), commit: commitOf(9) }),
      prStateChanged({ state: 'merged' }),
    );
    expect(toProjection(state, META).prState).toBe('merged');
  });

  it('pr_url and pr_state are absent before a delivery', () => {
    const row = toProjection(building(), META);
    expect(row.prUrl).toBeNull();
    expect(row.prState).toBeNull();
  });

  it('created_at is the time the Work order was created', () => {
    expect(toProjection(building(), META).createdAt).toBe(1000);
  });

  it('updated_at is the time of the last event', () => {
    expect(toProjection(building(), META).updatedAt).toBe(9000);
  });
});

describe('toProjection: shape and determinism', () => {
  const STORAGE_COLUMNS = [
    'order_id',
    'project_id',
    'todo_id',
    'title',
    'line',
    'priority',
    'depends_on',
    'last_seq',
    'status',
    'holder',
    'next_kind',
    'job_kind',
    'runner',
    'required_capabilities',
    'station_id',
    'station_index',
    'progressed',
    'resumed',
    'last_cell_id',
    'avoid_cells',
    'andon_reason',
    'pr_url',
    'pr_state',
    'created_at',
    'updated_at',
  ];

  it('has exactly the columns of the orders table', () => {
    const snakeCase = Object.keys(toProjection(building(), META)).map((key) =>
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
    );
    expect(snakeCase).toEqual(STORAGE_COLUMNS);
  });

  it('gives the same row when folded twice from the same events', () => {
    expect(toProjection(building(), META)).toEqual(
      toProjection(building(), META),
    );
  });
});
