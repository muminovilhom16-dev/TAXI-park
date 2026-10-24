import { and, between, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { periodQuerySchema, resolvePeriod, type CrmStats } from "@taxi/shared";
import { aggregatorDriverAccounts, drivers } from "../db/schema/index.js";
import { parseInput } from "../lib/errors.js";
import { driverScope } from "../lib/scope.js";

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  // Formulas are listed in the web app next to each card; keep them in sync.
  app.get(
    "/crm",
    { preHandler: app.requireAnyPermission("drivers.read_all", "drivers.read_assigned") },
    async (req): Promise<CrmStats> => {
      const q = parseInput(periodQuerySchema, req.query);
      const period = resolvePeriod(q.period, q);
      const live = and(driverScope(req), isNull(drivers.archivedAt));
      const n = sql<number>`count(*)::int`;
      const countWhere = async (extra?: ReturnType<typeof and>) =>
        (await app.db.select({ n }).from(drivers).where(and(live, extra)))[0]?.n ?? 0;

      const [totalDrivers, activeDrivers, newDrivers, inactiveDrivers, withoutManager, withoutAggregatorAccount] =
        await Promise.all([
          countWhere(),
          countWhere(eq(drivers.crmStatus, "active")),
          countWhere(between(drivers.registeredOn, period.from, period.to)),
          countWhere(inArray(drivers.crmStatus, ["suspended", "terminated"])),
          countWhere(isNull(drivers.managerId)),
          countWhere(
            notExists(
              app.db
                .select({ one: sql`1` })
                .from(aggregatorDriverAccounts)
                .where(and(eq(aggregatorDriverAccounts.driverId, drivers.id), isNull(aggregatorDriverAccounts.unlinkedAt))),
            ),
          ),
        ]);
      return { period, totalDrivers, activeDrivers, newDrivers, inactiveDrivers, withoutManager, withoutAggregatorAccount };
    },
  );
};
