import { describe, expect, it } from 'vitest';
import type { StoredEvent } from '@repo/factory-core/order/events';
import { describeFailure } from '../render/failure';
import {
  ageOf,
  type BoardRow,
  actionNeededOf,
  isHiddenByDefault,
  paintHolder,
  paintStatus,
  renderActionNeeded,
  renderBoard,
  TERMINAL_WINDOW_MS,
} from '../render/board';
import {
  actionsOf,
  cyclesOf,
  openQuestionOf,
  renderOrder,
} from '../render/order';
import { colorPaint, paintFor, plainPaint } from '../render/paint';
import {
  familyOf,
  formatClock,
  renderEventLine,
  renderTraveler,
  shortId,
} from '../render/log-view';

const ESC = '\u001b[';
const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);

const row = (overrides: Record<string, unknown> = {}): BoardRow =>
  ({
    orderId: 'software-factory:todo-a',
    projectId: 'software-factory',
    todoId: 'todo-a',
    title: 'Title todo-a',
    line: 'feature',
    priority: 'medium',
    status: 'queued',
    holder: 'queue',
    nextKind: 'busy',
    jobKind: null,
    runner: null,
    stationId: 'plan',
    stationIndex: 0,
    progressed: false,
    resumed: false,
    lastSeq: 1,
    andonReason: null,
    prUrl: null,
    prState: null,
    updatedAt: NOW,
    dependsOn: [],
    ...overrides,
  }) as unknown as BoardRow;

const stored = (seq: number, event: Record<string, unknown>): StoredEvent =>
  ({
    schemaVersion: 2,
    seq,
    globalSeq: seq,
    orderId: 'software-factory:todo-a',
    at: Date.UTC(2026, 10, 14, 11, 27, 46),
    actor: { kind: 'factory' },
    commandId: 'cmd',
    event,
  }) as unknown as StoredEvent;

describe('paint', () => {
  it('leaves text untouched when colour is off', () => {
    expect(plainPaint.red('andon')).toBe('andon');
    expect(paintFor(false).cyan('running')).toBe('running');
  });

  it('wraps text in ANSI codes when colour is on', () => {
    expect(colorPaint.red('andon')).toContain(`${ESC}31m`);
    expect(paintFor(true).green('merged')).toContain(`${ESC}32m`);
  });
});

describe('board', () => {
  it('colours each board status in its own colour', () => {
    expect(paintStatus(colorPaint, 'running')).toContain(`${ESC}36m`);
    expect(paintStatus(colorPaint, 'waiting_answer')).toContain(`${ESC}33m`);
    expect(paintStatus(colorPaint, 'andon')).toContain(`${ESC}31m`);
    expect(paintStatus(colorPaint, 'delivering')).toContain(`${ESC}34m`);
    expect(paintStatus(colorPaint, 'merged')).toContain(`${ESC}32m`);
    expect(paintStatus(colorPaint, 'cancelled')).toContain(`${ESC}90m`);
  });

  it('colours the holder: a Cell, the Supervisor, or the queue', () => {
    expect(paintHolder(colorPaint, 'cell')).toContain(`${ESC}36m`);
    expect(paintHolder(colorPaint, 'supervisor')).toContain(`${ESC}31m`);
    expect(paintHolder(colorPaint, 'queue')).toContain(`${ESC}2m`);
  });

  it('prints a table with no escape codes when colour is off', () => {
    const text = renderBoard(
      [row({ status: 'running', holder: 'cell' })],
      plainPaint,
      NOW,
    );

    expect(text).not.toContain('\u001b');
    expect(text.split('\n')[1]).toContain('software-factory:todo-a');
    expect(text.split('\n')[1]).toContain('running');
  });

  it('says so when there are no work orders', () => {
    expect(renderBoard([], plainPaint, NOW)).toBe('no work orders');
  });

  it('hides a terminal order last updated more than seven days ago', () => {
    const old = row({
      status: 'merged',
      updatedAt: NOW - TERMINAL_WINDOW_MS - 1,
    });
    const recent = row({ status: 'merged', updatedAt: NOW - 1000 });
    const open = row({
      status: 'running',
      updatedAt: NOW - TERMINAL_WINDOW_MS - 1,
    });

    expect(isHiddenByDefault(old, NOW)).toBe(true);
    expect(isHiddenByDefault(recent, NOW)).toBe(false);
    expect(isHiddenByDefault(open, NOW)).toBe(false);
  });

  it('shows the age in minutes, hours and days', () => {
    expect(ageOf(NOW - 5 * 60_000, NOW)).toBe('5m');
    expect(ageOf(NOW - 3 * 3_600_000, NOW)).toBe('3h');
    expect(ageOf(NOW - 2 * 86_400_000, NOW)).toBe('2d');
  });
});

describe('Traveler', () => {
  it('sorts each event family into its own colour', () => {
    expect(familyOf('job_claimed')).toBe('lifecycle');
    expect(familyOf('cycle_started')).toBe('cycle');
    expect(familyOf('andon_raised')).toBe('andon');
    expect(familyOf('question_asked')).toBe('question');
    expect(familyOf('delivery_finished')).toBe('delivery');
  });

  it('prints the clock, the sequence, the type and a short summary', () => {
    const line = renderEventLine(
      stored(3, {
        type: 'cycle_started',
        cycleId: '01M7CX0FY9EC8TJ78WPDB8XSSD',
        stationId: 'plan',
        n: 1,
      }),
      plainPaint,
    );

    expect(line).toBe(
      '11:27:46    3 cycle_started        cycle 01M7CX0F station plan n=1',
    );
  });

  it('dims the timestamp in colour', () => {
    const line = renderEventLine(
      stored(1, { type: 'order_created' }),
      colorPaint,
    );

    expect(line.startsWith(`${ESC}2m11:27:46${ESC}22m`)).toBe(true);
  });

  it('prints one line per event, oldest first', () => {
    const text = renderTraveler(
      [
        stored(1, { type: 'order_created' }),
        stored(2, {
          type: 'job_claimed',
          jobId: '01M7CX0FY9EC8TJ78WPDB8XSSD',
          kind: 'run_operator_station',
          cellId: 'cell-a',
          epoch: 1,
        }),
      ],
      plainPaint,
    );

    expect(text.split('\n')).toHaveLength(2);
  });

  it('shortens ids to eight characters and keeps short ones', () => {
    expect(shortId('01M7CX0FY9EC8TJ78WPDB8XSSD')).toBe('01M7CX0F');
    expect(shortId('todo-a')).toBe('todo-a');
  });

  it('formats the clock in UTC', () => {
    expect(formatClock(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe('03:04:05');
  });
});

describe('questions', () => {
  it('is answerable until an answer arrives, including an abandoned one', () => {
    const asked = stored(1, {
      type: 'question_asked',
      cycleId: '01M7CX0FY9EC8TJ78WPDB8XSSD',
      questionId: '01M7CX0FQ',
      text: 'Which branch?',
    });
    const abandoned = stored(2, {
      type: 'question_abandoned',
      questionId: '01M7CX0FQ',
    });
    const answered = stored(3, {
      type: 'question_answered',
      questionId: '01M7CX0FQ',
      by: 'supervisor',
      text: 'main',
    });

    expect(openQuestionOf([asked])?.text).toBe('Which branch?');
    expect(openQuestionOf([asked, abandoned])?.text).toBe('Which branch?');
    expect(openQuestionOf([asked, answered])).toBeUndefined();
  });

  it('shows an open question in the order detail', () => {
    const text = renderOrder(
      {
        order: row({ status: 'waiting_answer', holder: 'cell' }),
        events: [
          stored(1, {
            type: 'question_asked',
            cycleId: '01M7CX0FY9EC8TJ78WPDB8XSSD',
            questionId: '01M7CX0FY9EC8TJ78WPDB8XSSQ',
            text: 'Which branch?',
          }),
        ],
      },
      plainPaint,
      NOW,
    );

    expect(text).toContain('question  01M7CX0F: Which branch?');
  });
});

const CYCLE = '01M7CX0FY9EC8TJ78WPDB8XSSD';
const started = (seq: number, cycleId: string, stationId: string) =>
  stored(seq, {
    type: 'cycle_started',
    cycleId,
    jobId: `job-${cycleId}`,
    stationId,
    n: 1,
    cause: 'advance',
    baseCommit: 'a'.repeat(40),
  });

describe('cycle outcomes', () => {
  it('closes a review station on its recorded verdict, passed or failed', () => {
    const passed = cyclesOf([
      started(1, CYCLE, 'plan-review'),
      stored(2, {
        type: 'verdict_recorded',
        cycleId: CYCLE,
        pass: true,
        artifacts: [],
      }),
    ]);
    const failed = cyclesOf([
      started(1, CYCLE, 'quality-gate'),
      stored(2, {
        type: 'verdict_recorded',
        cycleId: CYCLE,
        pass: false,
        artifacts: [],
      }),
    ]);

    expect(passed[0]?.end).toBe('passed');
    expect(failed[0]?.end).toBe('failed');
  });

  it('closes an audit station on its inspection result, passed or failed', () => {
    const passed = cyclesOf([
      started(1, CYCLE, 'audit'),
      stored(2, {
        type: 'inspection_finished',
        cycleId: CYCLE,
        passed: true,
        results: [],
      }),
    ]);
    const failed = cyclesOf([
      started(1, CYCLE, 'audit'),
      stored(2, {
        type: 'inspection_finished',
        cycleId: CYCLE,
        passed: false,
        results: [],
      }),
    ]);

    expect(passed[0]?.end).toBe('passed');
    expect(failed[0]?.end).toBe('failed');
  });

  it('keeps a Cycle without an ending event running', () => {
    expect(cyclesOf([started(1, CYCLE, 'build')])[0]?.end).toBe('running');
  });

  it('shows the outcome, not the raw event type, in the order detail', () => {
    const text = renderOrder(
      {
        order: row({ status: 'queued' }),
        events: [
          started(1, CYCLE, 'audit'),
          stored(2, {
            type: 'inspection_finished',
            cycleId: CYCLE,
            passed: true,
            results: [],
          }),
        ],
      },
      plainPaint,
      NOW,
    );

    expect(text).toContain('audit');
    expect(text).toContain('passed');
    expect(text).not.toContain('running');
  });
});

describe('actions', () => {
  it('suggests resume, resume from a station and cancel for an Andon', () => {
    const lines = actionsOf(row({ status: 'andon' }));

    expect(lines).toEqual([
      'factory resume software-factory:todo-a',
      'factory resume software-factory:todo-a --from <station> --note "..."',
      'factory cancel software-factory:todo-a --reason "..."',
    ]);
  });

  it('suggests the answer command while a question waits', () => {
    expect(actionsOf(row({ status: 'waiting_answer' }))[0]).toBe(
      'factory answer software-factory:todo-a "..."',
    );
  });

  it('suggests reopen for a cancelled Work order', () => {
    expect(actionsOf(row({ status: 'cancelled' }))).toEqual([
      'factory reopen software-factory:todo-a',
    ]);
  });

  it('suggests priority and cancel for a queued Work order', () => {
    expect(actionsOf(row({ status: 'queued' }))).toEqual([
      'factory prio software-factory:todo-a <high|medium|low>',
      'factory cancel software-factory:todo-a --reason "..."',
    ]);
  });

  it('suggests nothing for a delivered Work order', () => {
    expect(actionsOf(row({ status: 'merged' }))).toEqual([]);
  });

  it('prints an actions section at the bottom of the order detail', () => {
    const text = renderOrder(
      { order: row({ status: 'cancelled' }), events: [] },
      plainPaint,
      NOW,
    );

    expect(
      text.endsWith('actions\n  factory reopen software-factory:todo-a'),
    ).toBe(true);
  });

  it('prints no actions section when the state has no next command', () => {
    const text = renderOrder(
      { order: row({ status: 'merged' }), events: [] },
      plainPaint,
      NOW,
    );

    expect(text).not.toContain('actions');
  });
});

describe('action needed', () => {
  it('lists the rows that wait for the Supervisor, with the reason and the command', () => {
    const lines = actionNeededOf([
      row({
        orderId: 'software-factory:a',
        status: 'andon',
        andonReason: 'build failed',
      }),
      row({ orderId: 'software-factory:b', status: 'waiting_answer' }),
      row({ orderId: 'software-factory:c', status: 'running' }),
    ]);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('andon: build failed');
    expect(lines[0]).toContain('factory resume software-factory:a');
    expect(lines[1]).toContain('factory answer software-factory:b');
  });

  it('names the dependencies that hold a Work order back', () => {
    const lines = actionNeededOf([
      row({
        orderId: 'software-factory:d',
        status: 'waiting_deps',
        dependsOn: ['software-factory:a'],
      } as Partial<BoardRow>),
      row({
        orderId: 'software-factory:e',
        status: 'deps_broken',
        dependsOn: ['software-factory:x'],
      } as Partial<BoardRow>),
    ]);

    expect(lines[0]).toContain('waiting on software-factory:a');
    expect(lines[1]).toContain('software-factory:x is broken');
  });

  it('prints nothing when no row needs the Supervisor', () => {
    expect(renderActionNeeded([row({ status: 'running' })], plainPaint)).toBe(
      '',
    );
  });

  it('prints a titled block when a row needs the Supervisor', () => {
    const text = renderActionNeeded(
      [row({ status: 'waiting_answer' })],
      plainPaint,
    );

    expect(text.split('\n')[0]).toBe('Action needed');
  });
});

describe('failures', () => {
  it('says what a refusal means in one line', () => {
    expect(describeFailure({ code: 'not_found' })).toContain('not found');
    expect(describeFailure({ code: 'precondition', detail: 'no Andon' })).toBe(
      'refused: no Andon',
    );
    expect(
      describeFailure({ code: 'invalid', issues: ['a: bad', 'b: bad'] }),
    ).toBe('invalid: a: bad; b: bad');
    expect(describeFailure({ code: 'unauthorized' })).toContain('revoked');
  });
});
