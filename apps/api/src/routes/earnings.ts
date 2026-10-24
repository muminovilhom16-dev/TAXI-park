import { aliasedTable, and, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  earningCreateSchema,
  earningImportSchema,
  earningListQuerySchema,
  voidSchema,
  type EarningRow,
  type EarningTotals,
} from "@taxi/shared";
import { aggregators, dailyEarnings, drivers, importBatches, users } from "../db/schema/index.js";
import { writeAudit } from "../lib/audit.js";
import { AppError, conflict, isUniqueViolation, notFound, parseInput } from "../lib/errors.js";
import { buildImportPreview, sha256 } from "../services/earnings-import.js";
import { getFinanceSettings, insertEarning, voidEarning } from "../services/finance.js";

const idParams = z.object({ id: z.string().uuid() });
const commitSchema = earningImportSchema.extend({ sha256: z.string().length(64) });

export const earningRoutes: FastifyPluginAsync = async (app) => {
  const canRead = app.requirePermission("finance.read");
  const canEnter = app.requirePermission("imports.run");
  // Voiding changes what the park has earned; it needs approval rights.
  const canVoid = app.requirePermission("settlements.approve");

  app.get("/", { preHandler: canRead }, async (req): Promise<{ items: EarningRow[]; total: number; totals: EarningTotals }> => {
    const q = parseInput(earningListQuerySchema, req.query);
    const where = and(
      q.from ? gte(dailyEarnings.workDate, q.from) : undefined,
      q.to ? lte(dailyEarnings.workDate, q.to) : undefined,
      q.driverId ? eq(dailyEarnings.driverId, q.driverId) : undefined,
      q.aggregatorId ? eq(dailyEarnings.aggregatorId, q.aggregatorId) : undefined,
      q.status === "all" ? undefined : eq(dailyEarnings.status, q.status),
    );
    const creator = aliasedTable(users, "creator");
    const [rows, [agg]] = await Promise.all([
      app.db
        .select({
          e: dailyEarnings,
          driverFirst: drivers.firstName,
          driverLast: drivers.lastName,
          aggregatorName: aggregators.name,
          createdByName: creator.fullName,
        })
        .from(dailyEarnings)
        .innerJoin(drivers, eq(drivers.id, dailyEarnings.driverId))
        .innerJoin(aggregators, eq(aggregators.id, dailyEarnings.aggregatorId))
        .innerJoin(creator, eq(creator.id, dailyEarnings.createdBy))
        .where(where)
        .orderBy(desc(dailyEarnings.workDate), drivers.lastName, drivers.firstName)
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      // Totals only ever count active rows, whatever the status filter.
      app.db
        .select({
          total: count(),
          count: sql<number>`count(*) filter (where ${dailyEarnings.status} = 'active')::int`,
          gross: sql<string>`coalesce(sum(${dailyEarnings.grossAmount}) filter (where ${dailyEarnings.status} = 'active'), 0)::numeric(18,2)`,
          commission: sql<string>`coalesce(sum(${dailyEarnings.commissionAmount}) filter (where ${dailyEarnings.status} = 'active'), 0)::numeric(18,2)`,
        })
        .from(dailyEarnings)
        .where(where),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.e.id,
        workDate: r.e.workDate,
        driver: { id: r.e.driverId, fullName: `${r.driverLast} ${r.driverFirst}` },
        aggregator: { id: r.e.aggregatorId, name: r.aggregatorName },
        grossAmount: r.e.grossAmount,
        commissionRatePercent: r.e.commissionRatePercent,
        commissionAmount: r.e.commissionAmount,
        source: r.e.source,
        status: r.e.status,
        note: r.e.note,
        voidReason: r.e.voidReason,
        createdBy: r.createdByName,
        createdAt: r.e.createdAt.toISOString(),
      })),
      total: agg?.total ?? 0,
      totals: { count: agg?.count ?? 0, grossAmount: agg?.gross ?? "0.00", commissionAmount: agg?.commission ?? "0.00" },
    };
  });

  app.post("/", { preHandler: canEnter }, async (req, reply) => {
    const input = parseInput(earningCreateSchema, req.body);
    const row = await app.db.transaction(async (tx) => {
      const settings = await getFinanceSettings(tx);
      const created = await insertEarning(tx, input, { userId: req.auth!.user.id, settings, source: "manual" });
      await writeAudit(tx, req, { action: "earning.create", entityType: "daily_earning", entityId: created.id, after: created });
      return created;
    });
    return reply.status(201).send(row);
  });

  app.post("/:id/void", { preHandler: canVoid }, async (req) => {
    const { id } = parseInput(idParams, req.params);
    const { reason } = parseInput(voidSchema, req.body);
    return app.db.transaction(async (tx) => {
      const settings = await getFinanceSettings(tx);
      const { before, after } = await voidEarning(tx, id, reason, req.auth!.user.id, settings);
      await writeAudit(tx, req, { action: "earning.void", entityType: "daily_earning", entityId: id, before, after });
      return after;
    });
  });

  app.post("/import/preview", { preHandler: canEnter }, async (req) => {
    const input = parseInput(earningImportSchema, req.body);
    const { preview } = await buildImportPreview(app.db, input.aggregatorId, input.content);
    return preview;
  });

  // The client sends back the file it previewed; the hash proves it is the same one.
  app.post("/import/commit", { preHandler: canEnter }, async (req, reply) => {
    const input = parseInput(commitSchema, req.body);
    if (sha256(input.content) !== input.sha256) {
      throw new AppError(400, "file_changed", "Fayl ko'rib chiqilgandan keyin o'zgargan. Qaytadan yuklang");
    }
    const [agg] = await app.db.select({ id: aggregators.id }).from(aggregators).where(eq(aggregators.id, input.aggregatorId));
    if (!agg) throw notFound("Agregator");
    const [done] = await app.db
      .select({ id: importBatches.id })
      .from(importBatches)
      .where(and(eq(importBatches.aggregatorId, agg.id), eq(importBatches.fileSha256, input.sha256)));
    if (done) throw conflict("Bu fayl shu agregator uchun allaqachon yuklangan");
    try {
      const result = await app.db.transaction(async (tx) => {
        const settings = await getFinanceSettings(tx);
        // Rebuilt inside the transaction: the preview may be stale by now.
        const { preview, valid } = await buildImportPreview(tx, input.aggregatorId, input.content);
        if (valid.length === 0) throw new AppError(400, "nothing_to_import", "Faylda kiritiladigan to'g'ri qator yo'q");
        const [batch] = await tx
          .insert(importBatches)
          .values({
            aggregatorId: input.aggregatorId,
            fileName: input.fileName,
            fileSha256: input.sha256,
            fileSize: Buffer.byteLength(input.content, "utf8"),
            mimeType: "text/csv",
            status: "committed",
            columnMapping: preview.columns,
            rowsTotal: preview.rows.length,
            rowsValid: preview.counts.valid,
            rowsInvalid: preview.counts.invalid,
            rowsDuplicate: preview.counts.duplicate,
            rowsUnknownDriver: preview.counts.unknown_driver,
            errorSummary: preview.rows.filter((r) => r.status !== "valid").slice(0, 200),
            uploadedBy: req.auth!.user.id,
            committedBy: req.auth!.user.id,
            committedAt: new Date(),
          })
          .returning();
        for (const v of valid) {
          await insertEarning(tx, { ...v, aggregatorId: input.aggregatorId }, {
            userId: req.auth!.user.id,
            settings,
            source: "csv",
            importBatchId: batch!.id,
          });
        }
        await writeAudit(tx, req, {
          action: "earning.import",
          entityType: "import_batch",
          entityId: batch!.id,
          after: { fileName: input.fileName, counts: preview.counts, totals: preview.totals },
        });
        return { batchId: batch!.id, imported: valid.length, counts: preview.counts, totals: preview.totals };
      });
      return reply.status(201).send(result);
    } catch (err) {
      if (isUniqueViolation(err, "import_batches_file_uq")) {
        throw conflict("Bu fayl shu agregator uchun allaqachon yuklangan");
      }
      throw err;
    }
  });
};
