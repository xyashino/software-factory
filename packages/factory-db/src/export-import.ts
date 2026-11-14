import { asc } from 'drizzle-orm';
import { TEXT_MAX_BYTES, blobRefsIn } from '@repo/factory-core/blob-rules';
import type { BlobRef } from '@repo/factory-core/ids';
import {
  type StoredEvent,
  storedEventSchema,
} from '@repo/factory-core/order/events';
import type { FactoryDatabase } from './db';
import { type ProjectRow, rebuildOn } from './rebuild-projections';
import { blobs, type ProjectRecord, events, projects } from './schema';
import { putBlobOn, readBlobOn } from './sqlite-blob-store';
import {
  SCHEMA_VERSION,
  type SqliteEventStore,
  feedRows,
} from './sqlite-event-store';
import { type TarEntry, readTar, writeTar } from './tar';

/**
 * The portable export format (STORAGE §7.3): `export.factory.tar` holds `manifest.json`,
 * `projects.jsonl`, `events.jsonl` in global order, and `blobs/<sha256 hex>` for every stored blob an
 * event cites. Leases, tokens, Cells, signals and the idempotency table are not exported.
 */
export const EXPORT_FORMAT = 'factory-export';
export const EXPORT_VERSION = 1;

const MANIFEST = 'manifest.json';
const PROJECTS = 'projects.jsonl';
const EVENTS = 'events.jsonl';
const BLOB_ENTRY = /^blobs\/([0-9a-f]{64})$/;
const PAGE = 500;

export interface Manifest {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: number;
  globalSeq: number;
  schemaVersion: number;
}

export interface ImportResult {
  projects: number;
  events: number;
  blobs: number;
  orders: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One JSON value per line, as `.jsonl` is written. */
const linesOf = (values: readonly unknown[]): Uint8Array =>
  encoder.encode(values.map((value) => `${JSON.stringify(value)}\n`).join(''));

/** The non-empty lines of a `.jsonl` entry, each parsed as JSON. */
const parseLines = (bytes: Uint8Array, name: string): unknown[] =>
  decoder
    .decode(bytes)
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        throw new Error(`${name} line ${index + 1} is not JSON`);
      }
    });

/** Every stored event, in global order, read a page at a time. */
const allEvents = (orm: FactoryDatabase): StoredEvent[] => {
  const all: StoredEvent[] = [];
  let after = 0;
  for (;;) {
    const page = feedRows(orm, after, PAGE);
    all.push(...page);
    if (page.length < PAGE) return all;
    after = page[page.length - 1]?.globalSeq ?? after;
  }
};

const archiveOn = (orm: FactoryDatabase, exportedAt: number): Uint8Array => {
  const projectRows = orm
    .select()
    .from(projects)
    .orderBy(asc(projects.projectId))
    .all();
  const eventRows = allEvents(orm);
  const eventBytes = linesOf(eventRows);

  const cited = new Set<BlobRef>();
  for (const ref of blobRefsIn(decoder.decode(eventBytes))) cited.add(ref);
  const blobEntries: TarEntry[] = [];
  for (const ref of [...cited].sort()) {
    const bytes = readBlobOn(orm, ref);
    // A cited blob that is not stored is a broken Factory: an archive without it would import cleanly
    // and leave events pointing at nothing, so the export refuses instead.
    if (!bytes) {
      throw new Error(
        `cannot export: an event cites blob ${ref}, which is not stored`,
      );
    }
    blobEntries.push({ name: `blobs/${ref.slice('sha256:'.length)}`, bytes });
  }

  const manifest: Manifest = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt,
    globalSeq: eventRows[eventRows.length - 1]?.globalSeq ?? 0,
    schemaVersion: SCHEMA_VERSION,
  };
  return writeTar([
    { name: MANIFEST, bytes: encoder.encode(JSON.stringify(manifest)) },
    { name: PROJECTS, bytes: linesOf(projectRows) },
    { name: EVENTS, bytes: eventBytes },
    ...blobEntries,
  ]);
};

/**
 * Writes the whole Factory as one archive, read in one write transaction so the parts agree with each
 * other (STORAGE §7.3). `exportedAt` is the Factory clock, in milliseconds.
 */
export const exportFactory = (
  store: SqliteEventStore,
  exportedAt: number,
): Promise<Uint8Array> => store.exclusive((orm) => archiveOn(orm, exportedAt));

const parseManifest = (bytes: Uint8Array): Manifest => {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes)) as unknown;
  } catch {
    throw new Error('manifest.json is not JSON');
  }
  const manifest = value as Partial<Manifest>;
  if (manifest.format !== EXPORT_FORMAT) {
    throw new Error(
      `not a factory export: format "${String(manifest.format)}"`,
    );
  }
  if (manifest.version !== EXPORT_VERSION) {
    throw new Error(`unsupported export version ${String(manifest.version)}`);
  }
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `unsupported schema version ${String(manifest.schemaVersion)}, expected ${SCHEMA_VERSION}`,
    );
  }
  if (
    !Number.isSafeInteger(manifest.globalSeq) ||
    (manifest.globalSeq ?? -1) < 0
  ) {
    throw new Error('manifest globalSeq must be a non-negative integer');
  }
  if (typeof manifest.exportedAt !== 'number') {
    throw new Error('manifest exportedAt must be a number');
  }
  return manifest as Manifest;
};

const projectOf = (value: unknown): ProjectRecord => {
  const row = value as Partial<ProjectRecord>;
  const depPolicies = ['delivered', 'merged'];
  if (
    typeof row.projectId !== 'string' ||
    typeof row.repoUrl !== 'string' ||
    typeof row.baseBranch !== 'string' ||
    typeof row.maxRunning !== 'number' ||
    !depPolicies.includes(row.depPolicy ?? '') ||
    typeof row.createdAt !== 'number'
  ) {
    throw new Error(`projects line is not a project: ${JSON.stringify(value)}`);
  }
  return row as ProjectRecord;
};

const requireEntry = (
  files: ReadonlyMap<string, Uint8Array>,
  name: string,
): Uint8Array => {
  const bytes = files.get(name);
  if (!bytes) throw new Error(`export has no ${name}`);
  return bytes;
};

/** Refuses an import unless the database holds no project, event or blob yet. */
const ensureEmpty = (orm: FactoryDatabase): void => {
  const occupied =
    orm.select().from(projects).limit(1).all().length > 0 ||
    orm.select().from(events).limit(1).all().length > 0 ||
    orm.select().from(blobs).limit(1).all().length > 0;
  if (occupied) {
    throw new Error(
      'import needs an empty database: projects, events or blobs exist',
    );
  }
};

const importOn = (
  orm: FactoryDatabase,
  archive: Uint8Array,
  project: ProjectRow,
  importedAt: number,
): ImportResult => {
  const files = new Map<string, Uint8Array>();
  for (const entry of readTar(archive)) {
    const known =
      entry.name === MANIFEST ||
      entry.name === PROJECTS ||
      entry.name === EVENTS ||
      BLOB_ENTRY.test(entry.name);
    if (!known) throw new Error(`unexpected export entry "${entry.name}"`);
    if (files.has(entry.name))
      throw new Error(`duplicate export entry "${entry.name}"`);
    files.set(entry.name, entry.bytes);
  }

  const manifest = parseManifest(requireEntry(files, MANIFEST));
  const projectValues = parseLines(requireEntry(files, PROJECTS), PROJECTS).map(
    projectOf,
  );
  // Each event line is checked against the envelope schema, and its payload is kept as written.
  const stored = parseLines(requireEntry(files, EVENTS), EVENTS).map(
    (value) => ({
      envelope: storedEventSchema.parse(value),
      payload: (value as { event: unknown }).event,
    }),
  );

  ensureEmpty(orm);

  let previous = 0;
  for (const { envelope } of stored) {
    if (envelope.globalSeq <= previous) {
      throw new Error(
        `events are not in global order at ${envelope.globalSeq}`,
      );
    }
    previous = envelope.globalSeq;
  }
  if (manifest.globalSeq !== previous) {
    throw new Error(
      `manifest globalSeq ${manifest.globalSeq} does not match the last event ${previous}`,
    );
  }

  for (const row of projectValues) orm.insert(projects).values(row).run();

  for (const [name, bytes] of files) {
    const match = BLOB_ENTRY.exec(name);
    if (!match) continue;
    const ref = `sha256:${match[1]}` as BlobRef;
    const kind = bytes.byteLength > TEXT_MAX_BYTES ? 'log' : 'text';
    putBlobOn(orm, ref, bytes, 'application/octet-stream', kind, importedAt);
  }

  for (const { envelope, payload } of stored) {
    orm
      .insert(events)
      .values({
        globalSeq: envelope.globalSeq,
        orderId: envelope.orderId,
        seq: envelope.seq,
        at: envelope.at,
        actor: JSON.stringify(envelope.actor),
        commandId: envelope.commandId,
        epoch: envelope.epoch ?? null,
        schemaVersion: envelope.schemaVersion,
        type: envelope.event.type,
        payload: JSON.stringify(payload),
      })
      .run();
  }

  const orderCount = rebuildOn(orm, project);
  return {
    projects: projectValues.length,
    events: stored.length,
    blobs: [...files.keys()].filter((name) => BLOB_ENTRY.test(name)).length,
    orders: orderCount,
  };
};

/**
 * Loads an export into an empty database, in one write transaction (STORAGE §7.3): projects, blobs
 * and events unchanged (events keep their `global_seq`), then the `orders` projection rebuilt by
 * `project`. Refuses a non-empty database, a bad manifest, an unsafe or truncated archive, a blob that
 * does not hash to its name, and events out of order. `ExpireLease` is appended by the runtime, not here.
 */
export const importFactory = (
  store: SqliteEventStore,
  archive: Uint8Array,
  project: ProjectRow,
  importedAt: number,
): Promise<ImportResult> =>
  store.exclusive((orm) => importOn(orm, archive, project, importedAt));
