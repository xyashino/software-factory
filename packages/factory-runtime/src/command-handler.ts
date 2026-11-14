import type { Job } from '@repo/factory-core/contracts/job';
import type { CommandResult } from '@repo/factory-core/contracts/worker';
import type { BlobRef, OrderId, WorkerId } from '@repo/factory-core/ids';
import type {
  Actor,
  OrderEvent,
  StoredEvent,
} from '@repo/factory-core/order/events';
import type { OrderCommand } from '@repo/factory-core/order/commands';
import { decide } from '@repo/factory-core/order/decide';
import { evolve } from '@repo/factory-core/order/evolve';
import { nextJob } from '@repo/factory-core/order/next-job';
import {
  toProjection,
  type OrderProjection,
} from '@repo/factory-core/order/projection';
import type { WorkOrderState } from '@repo/factory-core/order/state';
import type { Lease } from '@repo/factory-core/ports/lease-store';
import type { NewSignal } from '@repo/factory-core/ports/signals';
import { selectClaimable } from '@repo/factory-core/queue/select';
import { refusal, RuntimeError, unavailable } from './errors';
import { buildJob } from './job-builder';
import { orderLocks } from './order-lock';
import { readQueue, workerView } from './queue';
import type { RuntimePorts } from './ports';
import {
  blobRefsIn,
  decideContext,
  envelopeOf,
  foldHistory,
  lastSeqOf,
} from './state';

/** One command as the runtime receives it: from a Worker, the Supervisor or the factory itself. */
export interface CommandRequest {
  orderId: OrderId;
  commandId: string;
  command: OrderCommand;
  actor: Actor;
  /** The epoch the caller claims to hold; `decide` refuses it unless it is the active job's. */
  epoch?: number;
  dryRun?: boolean;
  /**
   * A Worker whose command ends its job. When this Work order's next job is one that Worker can run,
   * the runtime claims it in the same transaction and returns it as `next` (PROTOCOL §4).
   */
  continueFor?: WorkerId;
  /** `skip`: a refusal or an exhausted retry returns undefined instead of throwing (a claim's next candidate). */
  onRefusal?: 'throw' | 'skip';
}

/** What a command stores as its idempotent response: its events, and the job it leads to, if any. */
interface StoredResponse {
  events: OrderEvent[];
  next: Job | null;
}

/** Events and the state they fold into. The state is undefined only before the first event of an order. */
interface Working {
  events: OrderEvent[];
  state: WorkOrderState | undefined;
}

/** A command fully decided: what to append, with the lease and signals that follow the append. */
interface Prepared {
  orderId: OrderId;
  commandId: string;
  actor: Actor;
  epoch?: number;
  expectedSeq: number;
  events: OrderEvent[];
  projection: OrderProjection;
  next: Job | null;
  endedJobId?: string;
  lease?: Lease;
  signals: NewSignal[];
}

export interface CommandHandler {
  /**
   * Runs a command through the loop (CORE §5.2, STORAGE §3). Returns undefined only when the request
   * asks to skip refusals; otherwise a refusal throws RuntimeError.
   */
  submit(request: CommandRequest): Promise<CommandResult | undefined>;
}

/** The state a decided command leaves; a decided command always leaves one. */
const stateOf = (working: Working): WorkOrderState => {
  if (!working.state)
    throw new Error('a decided command left no Work order state');
  return working.state;
};

/**
 * The command loop: load → fold → decide → `andon_raised` when `nextJob` asks → project → append,
 * with the lease and the signals in the same transaction. A replayed `commandId` returns its stored
 * response before any decision. A conflict reloads and decides again, up to `commandAttempts`, then
 * `unavailable`. Writes need the writer lock; `onCommit` runs after each append (claim waiters wake).
 */
export const createCommandHandler = (
  ports: RuntimePorts,
  onCommit: () => void,
): CommandHandler => {
  const locks = orderLocks();
  const { events, blobs, leases, signals, ids, clock, writer, config } = ports;
  const jobPorts = { blobs, definitions: ports.definitions, config };

  const projectFor = async (projectId: string) => {
    const project = (await ports.projects.list()).find(
      (candidate) => candidate.projectId === projectId,
    );
    if (!project) {
      throw refusal({
        code: 'precondition',
        detail: `project ${projectId} is not registered`,
      });
    }
    return project;
  };

  const workerCanRun = async (
    workerId: WorkerId,
    orderId: OrderId,
    projection: OrderProjection,
  ): Promise<boolean> => {
    const worker = await ports.workers.get(workerId);
    if (!worker || worker.revokedAt !== null || !worker.info) return false;
    const heldElsewhere = (await leases.forWorker(workerId)).filter(
      (lease) => lease.orderId !== orderId,
    ).length;
    const queue = await readQueue(ports, projection);
    return selectClaimable(
      queue.entries,
      workerView(workerId, worker.info, heldElsewhere),
      queue.limits,
    ).some((entry) => entry.orderId === orderId);
  };

  const leaseFor = (
    orderId: OrderId,
    state: WorkOrderState,
    workerId: WorkerId,
  ): Lease => {
    const active = state.activeJob;
    if (!active) throw new Error('a claim left no active job');
    return {
      orderId,
      jobId: active.jobId,
      workerId,
      epoch: active.epoch,
      expiresAt: clock.now() + config.leaseTtlMs,
    };
  };

  const prepare = async (
    request: CommandRequest,
    stored: StoredEvent[],
  ): Promise<Prepared> => {
    const now = clock.now();
    const before = foldHistory(stored);
    const lastSeq = lastSeqOf(stored);
    const createdAt = stored[0]?.at ?? now;
    const refs: BlobRef[] = blobRefsIn(request.command);
    const sizes =
      refs.length > 0 ? await blobs.stat(refs) : new Map<BlobRef, number>();
    const decision = decide(
      before,
      request.command,
      decideContext(
        {
          now,
          ids,
          actor: request.actor,
          ...(request.epoch !== undefined ? { epoch: request.epoch } : {}),
        },
        sizes,
      ),
    );
    if (!decision.ok) throw refusal(decision.error);

    const appendTo = (working: Working, more: OrderEvent[]): Working => ({
      events: [...working.events, ...more],
      state: envelopeOf(more, {
        orderId: request.orderId,
        firstSeq: lastSeq + working.events.length + 1,
        at: now,
        actor: request.actor,
        commandId: request.commandId,
        ...(request.epoch !== undefined ? { epoch: request.epoch } : {}),
      }).reduce<WorkOrderState | undefined>(
        (state, stamped) => evolve(state, stamped),
        working.state,
      ),
    });
    const preview = (state: WorkOrderState, seq: number): OrderProjection =>
      toProjection(state, {
        lastSeq: seq,
        createdAt,
        updatedAt: now,
        next: nextJob(state),
      });

    let working = appendTo({ events: [], state: before }, decision.value);
    const pending = nextJob(stateOf(working));
    if (pending.kind === 'raise_andon') {
      working = appendTo(working, [
        {
          type: 'andon_raised',
          reason: pending.reason,
          detail: pending.detail,
        },
      ]);
    }

    let next: Job | null = null;
    let lease: Lease | undefined;
    const claimedJob = stateOf(working).activeJob;
    const beforeJobId = before?.activeJob?.jobId;

    if (request.command.type === 'ClaimJob' && claimedJob && before) {
      // The decision claimed the job itself: build what the Worker runs and lease it.
      const project = await projectFor(stateOf(working).projectId);
      const spec = nextJob(before);
      if (spec.kind !== 'job')
        throw new Error('a claim decided on a state with no job');
      next = await buildJob(jobPorts, stateOf(working), project, spec.job);
      lease = leaseFor(
        request.orderId,
        stateOf(working),
        request.command.workerId,
      );
    } else if (
      !request.dryRun &&
      request.continueFor !== undefined &&
      config.continuation &&
      stateOf(working).activeJob === undefined &&
      nextJob(stateOf(working)).kind === 'job'
    ) {
      // Continuation: tried on a copy, so a claim that cannot be built leaves the command's own events.
      const workerId = request.continueFor;
      const beforeClaim = working;
      const spec = nextJob(stateOf(beforeClaim));
      const canRun =
        spec.kind === 'job' &&
        (await workerCanRun(
          workerId,
          request.orderId,
          preview(stateOf(beforeClaim), lastSeq + beforeClaim.events.length),
        ));
      if (canRun && spec.kind === 'job') {
        try {
          const claim = decide(
            stateOf(beforeClaim),
            { type: 'ClaimJob', workerId },
            decideContext({ now, ids, actor: { kind: 'factory' } }, new Map()),
          );
          if (claim.ok) {
            const claimed = appendTo(beforeClaim, claim.value);
            const project = await projectFor(stateOf(claimed).projectId);
            next = await buildJob(
              jobPorts,
              stateOf(claimed),
              project,
              spec.job,
            );
            working = claimed;
            lease = leaseFor(request.orderId, stateOf(claimed), workerId);
          }
        } catch (error) {
          if (!(error instanceof RuntimeError)) throw error;
          next = null;
          lease = undefined;
          working = beforeClaim;
        }
      }
    }

    const finalState = stateOf(working);
    const projection = preview(finalState, lastSeq + working.events.length);
    const endedJobId =
      beforeJobId !== undefined && finalState.activeJob?.jobId !== beforeJobId
        ? beforeJobId
        : undefined;

    const signalsOut: NewSignal[] = [];
    const activeJobId = finalState.activeJob?.jobId;
    if (activeJobId !== undefined) {
      for (const event of working.events) {
        if (event.type === 'question_answered') {
          signalsOut.push({
            signalId: ids.signalId(),
            jobId: activeJobId,
            kind: 'answer',
            questionId: event.questionId,
            text: event.text,
            createdAt: now,
          });
        } else if (event.type === 'nudged') {
          signalsOut.push({
            signalId: ids.signalId(),
            jobId: activeJobId,
            kind: 'nudge',
            text: event.text,
            createdAt: now,
          });
        }
      }
    }

    return {
      orderId: request.orderId,
      commandId: request.commandId,
      actor: request.actor,
      ...(request.epoch !== undefined ? { epoch: request.epoch } : {}),
      expectedSeq: lastSeq,
      events: working.events,
      projection,
      next,
      ...(endedJobId !== undefined ? { endedJobId } : {}),
      ...(lease ? { lease } : {}),
      signals: signalsOut,
    };
  };

  /** One append in one transaction; the lease and the signals follow the facts they belong to. */
  const commit = (prepared: Prepared) =>
    events.transaction(async (tx) => {
      const response: StoredResponse = {
        events: prepared.events,
        next: prepared.next,
      };
      const result = await tx.append({
        orderId: prepared.orderId,
        commandId: prepared.commandId,
        expectedSeq: prepared.expectedSeq,
        actor: prepared.actor,
        ...(prepared.epoch !== undefined ? { epoch: prepared.epoch } : {}),
        at: clock.now(),
        events: prepared.events,
        projection: prepared.projection,
        response,
      });
      if (result.kind !== 'appended') return result;
      if (prepared.endedJobId !== undefined) {
        await leases.delete(prepared.orderId);
        await signals.deleteForJob(prepared.endedJobId as never);
      }
      if (prepared.lease) await leases.insert(prepared.lease);
      for (const signal of prepared.signals) await signals.insert(signal);
      return result;
    });

  const resultOf = (response: unknown): CommandResult => {
    const stored = response as StoredResponse;
    return { dryRun: false, events: stored.events, next: stored.next };
  };

  const submit = async (
    request: CommandRequest,
  ): Promise<CommandResult | undefined> => {
    writer.assertHeld();
    if (!request.dryRun) {
      const replay = await events.response(request.commandId);
      if (replay) return resultOf(replay.response);
    }
    return locks.run(request.orderId, async () => {
      try {
        for (let attempt = 1; attempt <= config.commandAttempts; attempt += 1) {
          const stored = await events.load(request.orderId);
          const prepared = await prepare(request, stored);
          if (request.dryRun) {
            return { dryRun: true, events: prepared.events, next: null };
          }
          const outcome = await commit(prepared);
          if (outcome.kind === 'appended') {
            onCommit();
            return {
              dryRun: false,
              events: prepared.events,
              next: prepared.next,
            };
          }
          if (outcome.kind === 'replayed') return resultOf(outcome.response);
        }
        throw unavailable();
      } catch (error) {
        if (request.onRefusal === 'skip' && error instanceof RuntimeError) {
          return undefined;
        }
        throw error;
      }
    });
  };

  return { submit };
};
