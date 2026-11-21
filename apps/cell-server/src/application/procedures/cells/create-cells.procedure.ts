import { hostname } from 'node:os';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { CELL_LOG_DIR } from '../../../config';
import { createCellsContract } from '../../../contracts/cells.contract';
import { immediateTx } from '../../../db/client';
import { cells } from '../../../db/schema/cells';
import { factories } from '../../../db/schema/factories';
import { asSlotId, type FactoryId } from '../../../domain/common/brand';
import {
  allocateSlotNames,
  assertCount,
} from '../../../domain/cells/slot-allocation';
import {
  asBadRequest,
  BadRequest,
  Conflict,
  NotFound,
} from '../../core/error-handling';
import { publicProcedure, type TransportContext } from '../../core/procedure';
import { listRecords, readSettings, toCellDto } from './cell-views';
import { startSlot } from './slot-runtime';

type FactoryRow = typeof factories.$inferSelect;

type EnrolledCell = { name: string; cellId: string; sessionToken: string };

const resolveFactory = (
  ctx: TransportContext,
  ref: string | undefined,
): FactoryRow => {
  const row =
    ref === undefined
      ? ctx.db
          .select()
          .from(factories)
          .where(eq(factories.isDefault, true))
          .get()
      : (ctx.db.select().from(factories).where(eq(factories.name, ref)).get() ??
        ctx.db
          .select()
          .from(factories)
          .where(eq(factories.factoryId, ref as FactoryId))
          .get());
  if (row === undefined)
    throw new NotFound(`factory not found: ${ref ?? 'default'}`);
  return row;
};

const joinCredentialOf = (
  ctx: TransportContext,
  factory: FactoryRow,
  explicit: string | undefined,
): Promise<string> => {
  if (explicit !== undefined) return Promise.resolve(explicit);
  if (factory.joinToken !== null) return Promise.resolve(factory.joinToken);
  if (factory.supervisorToken !== null)
    return ctx.factoryClient.mintJoinToken(
      factory.url,
      factory.supervisorToken,
    );
  throw new BadRequest(
    `factory ${factory.name} has no join credential: pass joinToken`,
  );
};

const provisionWorkspace = async (
  ctx: TransportContext,
  projectId: string | undefined,
  factoryRef: string | undefined,
): Promise<string> => {
  if (projectId === undefined)
    throw new BadRequest('repoRoot or projectId is required');
  const factory = resolveFactory(ctx, factoryRef);
  if (factory.supervisorToken === null)
    throw new BadRequest(
      `factory ${factory.name} has no supervisor token to list projects`,
    );
  const projects = await ctx.factoryClient.listProjects(
    factory.url,
    factory.supervisorToken,
  );
  const project = projects.find((item) => item.projectId === projectId);
  if (project === undefined)
    throw new NotFound(
      `project ${projectId} is not registered on factory ${factory.name}\nfix: sf project add ${projectId} --repo <url>`,
    );
  return ctx.workspace.ensure(project.projectId, project.repoUrl);
};

const takenNames = (ctx: TransportContext, repoRoot: string): string[] =>
  ctx.db
    .select({ name: cells.name })
    .from(cells)
    .where(eq(cells.repoRoot, repoRoot))
    .all()
    .map((row) => row.name);

export const createCellsProcedure = publicProcedure(createCellsContract)(async (
  input,
  ctx,
) => {
  const body = input.body;
  const repoRoot =
    body.repoRoot ??
    (await provisionWorkspace(ctx, body.projectId, body.factory));
  const repo = ctx.repoInspector.inspect(repoRoot);
  if (repo === null)
    throw new BadRequest(
      'repoRoot needs .factory/config.json and .factory/lines/*.yml',
    );
  if (body.projectId !== undefined && repo.projectId !== body.projectId)
    throw new Conflict(
      `repo at ${repoRoot} belongs to project ${repo.projectId}, not ${body.projectId}`,
    );
  const settings = readSettings(ctx.db);
  const count = body.count ?? 1;
  asBadRequest(() => assertCount(count, settings.max_local_cells));
  if (body.name !== undefined && count > 1)
    throw new BadRequest('name is only allowed with count 1');

  const factory = resolveFactory(ctx, body.factory);
  const taken = takenNames(ctx, repoRoot);
  if (body.name !== undefined && taken.includes(body.name))
    throw new Conflict(`cell name already exists: ${body.name}`);
  const names =
    body.name !== undefined
      ? [body.name]
      : allocateSlotNames(hostname(), count, taken);

  const credential = await joinCredentialOf(ctx, factory, body.joinToken);
  const enrolled: EnrolledCell[] = [];
  for (const name of names) {
    const cell = await ctx.factoryClient.enroll(factory.url, credential, {
      projectId: repo.projectId,
      name,
      allowedLines: body.allowedLines ?? ['*'],
      runners: [settings.default_runner],
    });
    enrolled.push({ name, ...cell });
  }

  const now = ctx.clock.now();
  const slotIds = immediateTx(ctx.db, (tx) =>
    enrolled.map((cell) => {
      const slotId = asSlotId(crypto.randomUUID());
      tx.insert(cells)
        .values({
          slotId,
          cellId: cell.cellId,
          factoryId: factory.factoryId,
          projectId: repo.projectId,
          repoRoot,
          name: cell.name,
          desiredState: 'stopped',
          runtimeStatus: 'stopped',
          pid: null,
          sessionToken: cell.sessionToken,
          logPath: join(CELL_LOG_DIR, `${slotId}.log`),
          lastError: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return slotId;
    }),
  );

  for (const record of listRecords(ctx.db, inArray(cells.slotId, slotIds)))
    await startSlot(ctx, record);
  const created = listRecords(ctx.db, inArray(cells.slotId, slotIds));
  return { code: 201 as const, cells: created.map(toCellDto) };
});
