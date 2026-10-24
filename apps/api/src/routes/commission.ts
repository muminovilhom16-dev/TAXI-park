import { desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { aggregators, commissionPolicies } from "../db/schema/index.js";

// Read-only for now: policies are created in the finance step, once the
// commission base is confirmed against a real aggregator report.
export const commissionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: app.requirePermission("finance.read") }, async () => {
    const items = await app.db
      .select({
        id: commissionPolicies.id,
        aggregator: aggregators.name,
        name: commissionPolicies.name,
        ratePercent: commissionPolicies.ratePercent,
        baseType: commissionPolicies.baseType,
        validFrom: commissionPolicies.validFrom,
        validTo: commissionPolicies.validTo,
        approvedAt: commissionPolicies.approvedAt,
      })
      .from(commissionPolicies)
      .innerJoin(aggregators, eq(aggregators.id, commissionPolicies.aggregatorId))
      .orderBy(desc(commissionPolicies.validFrom));
    return { items };
  });
};
