import { and, asc, count, eq, isNull } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { aggregatorSchema, updateAggregatorSchema, type AggregatorRow } from "@taxi/shared";
import { aggregatorDriverAccounts, aggregators } from "../db/schema/index.js";
import { writeAudit } from "../lib/audit.js";
import { conflict, forbidden, isUniqueViolation, notFound, parseInput } from "../lib/errors.js";
import { can } from "../lib/scope.js";

const idParams = z.object({ id: z.string().uuid() });

export const aggregatorRoutes: FastifyPluginAsync = async (app) => {
  // Anyone who works with drivers needs the list to link accounts and filter.
  const canRead = app.requireAnyPermission("aggregators.manage", "drivers.read_all", "drivers.read_assigned", "finance.read");
  const canManage = app.requirePermission("aggregators.manage");

  async function list(): Promise<AggregatorRow[]> {
    const linked = app.db
      .select({ aggregatorId: aggregatorDriverAccounts.aggregatorId, n: count().as("n") })
      .from(aggregatorDriverAccounts)
      .where(isNull(aggregatorDriverAccounts.unlinkedAt))
      .groupBy(aggregatorDriverAccounts.aggregatorId)
      .as("linked");
    const rows = await app.db
      .select({
        id: aggregators.id,
        code: aggregators.code,
        name: aggregators.name,
        isActive: aggregators.isActive,
        moneyFlowModel: aggregators.moneyFlowModel,
        integrationStatus: aggregators.integrationStatus,
        note: aggregators.note,
        linkedDrivers: linked.n,
      })
      .from(aggregators)
      .leftJoin(linked, eq(linked.aggregatorId, aggregators.id))
      .orderBy(asc(aggregators.name));
    return rows.map((r) => ({ ...r, linkedDrivers: Number(r.linkedDrivers ?? 0) }));
  }

  app.get("/", { preHandler: canRead }, async () => ({ items: await list() }));

  app.post("/", { preHandler: canManage }, async (req, reply) => {
    const input = parseInput(aggregatorSchema, req.body);
    // The money flow decides who owes whom; only the owner may confirm it.
    if (input.moneyFlowModel !== "unconfirmed" && !can(req, "settings.manage")) throw forbidden();
    try {
      const row = await app.db.transaction(async (tx) => {
        const [created] = await tx.insert(aggregators).values(input).returning();
        await writeAudit(tx, req, { action: "aggregator.create", entityType: "aggregator", entityId: created!.id, after: created });
        return created!;
      });
      return reply.status(201).send(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("Bu kod bilan agregator bor");
      throw err;
    }
  });

  app.patch("/:id", { preHandler: canManage }, async (req) => {
    const { id } = parseInput(idParams, req.params);
    const input = parseInput(updateAggregatorSchema, req.body);
    return app.db.transaction(async (tx) => {
      const [before] = await tx.select().from(aggregators).where(eq(aggregators.id, id)).for("update");
      if (!before) throw notFound("Agregator");
      if (input.moneyFlowModel !== undefined && input.moneyFlowModel !== before.moneyFlowModel && !can(req, "settings.manage")) {
        throw forbidden();
      }
      const [after] = await tx.update(aggregators).set(input).where(and(eq(aggregators.id, id))).returning();
      await writeAudit(tx, req, {
        action: before.moneyFlowModel !== after!.moneyFlowModel ? "aggregator.money_flow_change" : "aggregator.update",
        entityType: "aggregator",
        entityId: id,
        before,
        after,
      });
      return after;
    });
  });
};
