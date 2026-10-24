import { and, desc, eq, gte, isNull } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { commissionPolicyCreateSchema, type CommissionPolicyRow, type RoundingMode } from "@taxi/shared";
import { aggregators, appSettings, commissionPolicies } from "../db/schema/index.js";
import { writeAudit } from "../lib/audit.js";
import { AppError, isExclusionViolation, notFound, parseInput } from "../lib/errors.js";

// A rate change never rewrites history: the open policy is closed the day the
// new one starts, and earnings keep the rate they were computed with.
export const commissionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: app.requirePermission("finance.read") }, async (): Promise<{ items: CommissionPolicyRow[] }> => {
    const rows = await app.db
      .select({
        id: commissionPolicies.id,
        aggregatorId: commissionPolicies.aggregatorId,
        aggregator: aggregators.name,
        name: commissionPolicies.name,
        ratePercent: commissionPolicies.ratePercent,
        validFrom: commissionPolicies.validFrom,
        validTo: commissionPolicies.validTo,
        approvedAt: commissionPolicies.approvedAt,
      })
      .from(commissionPolicies)
      .innerJoin(aggregators, eq(aggregators.id, commissionPolicies.aggregatorId))
      .orderBy(aggregators.name, desc(commissionPolicies.validFrom));
    return { items: rows.map((r) => ({ ...r, approvedAt: r.approvedAt?.toISOString() ?? null })) };
  });

  app.post("/", { preHandler: app.requirePermission("commission.manage") }, async (req, reply) => {
    const input = parseInput(commissionPolicyCreateSchema, req.body);
    const [agg] = await app.db.select().from(aggregators).where(eq(aggregators.id, input.aggregatorId));
    if (!agg) throw notFound("Agregator");
    const [rounding] = await app.db.select().from(appSettings).where(eq(appSettings.key, "money.rounding"));
    const r = (rounding?.value ?? {}) as { mode?: RoundingMode; scale?: number };

    try {
      const row = await app.db.transaction(async (tx) => {
        // Earlier policies starting on or after this date would be rewritten; refuse.
        const [later] = await tx
          .select({ id: commissionPolicies.id })
          .from(commissionPolicies)
          .where(and(eq(commissionPolicies.aggregatorId, agg.id), gte(commissionPolicies.validFrom, input.validFrom)));
        if (later) {
          throw new AppError(409, "policy_overlap", "Bu sanadan keyin boshlanadigan stavka allaqachon bor");
        }
        const [open] = await tx
          .update(commissionPolicies)
          .set({ validTo: input.validFrom })
          .where(and(eq(commissionPolicies.aggregatorId, agg.id), isNull(commissionPolicies.validTo)))
          .returning();
        const [created] = await tx
          .insert(commissionPolicies)
          .values({
            aggregatorId: agg.id,
            name: `${agg.name}: ${input.ratePercent}%`,
            ratePercent: input.ratePercent,
            baseType: "gross_earnings",
            roundingMode: r.mode ?? "half_up",
            roundingScale: r.scale ?? 0,
            validFrom: input.validFrom,
            approvedBy: req.auth!.user.id,
            approvedAt: new Date(),
            createdBy: req.auth!.user.id,
          })
          .returning();
        await writeAudit(tx, req, {
          action: "commission_policy.create",
          entityType: "commission_policy",
          entityId: created!.id,
          before: open ? { closedPolicyId: open.id, ratePercent: open.ratePercent, validTo: open.validTo } : null,
          after: created,
        });
        return created!;
      });
      return reply.status(201).send(row);
    } catch (err) {
      if (isExclusionViolation(err)) {
        throw new AppError(409, "policy_overlap", "Bu davr uchun stavka allaqachon belgilangan");
      }
      throw err;
    }
  });
};
