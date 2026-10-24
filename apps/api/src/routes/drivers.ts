import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  archiveSchema,
  assignVehicleSchema,
  changeStatusSchema,
  createDriverSchema,
  driverListQuerySchema,
  linkAccountSchema,
  normalizeUzPhone,
  updateDriverSchema,
  type DuplicateMatch,
} from "@taxi/shared";
import type { DbOrTx, Tx } from "../db/client.js";
import {
  aggregatorDriverAccounts,
  aggregators,
  driverStatusHistory,
  driverVehicleAssignments,
  drivers,
  users,
  vehicles,
} from "../db/schema/index.js";
import { writeAudit } from "../lib/audit.js";
import {
  AppError,
  conflict,
  forbidden,
  isExclusionViolation,
  isUniqueViolation,
  notFound,
  parseInput,
} from "../lib/errors.js";
import { can, driverScope } from "../lib/scope.js";
import { getDriverDetail, listDrivers } from "../services/drivers.js";

const idParams = z.object({ id: z.string().uuid() });
const accountParams = z.object({ id: z.string().uuid(), accountId: z.string().uuid() });
const duplicateQuery = z.object({
  phone: z.string().optional(),
  aggregatorId: z.string().uuid().optional(),
  externalDriverId: z.string().trim().optional(),
  excludeId: z.string().uuid().optional(),
});

/** Locks a visible driver for a write; 404 when the caller cannot see it. */
async function lockDriver(tx: Tx, req: FastifyRequest, id: string) {
  const [row] = await tx
    .select()
    .from(drivers)
    .where(and(eq(drivers.id, id), driverScope(req)))
    .for("update");
  if (!row) throw notFound("Haydovchi");
  return row;
}

function assertNotArchived(row: { archivedAt: Date | null }) {
  if (row.archivedAt) throw new AppError(409, "archived", "Haydovchi arxivda. Avval arxivdan chiqaring");
}

async function assertManager(db: DbOrTx, managerId: string | null) {
  if (!managerId) return;
  const [m] = await db.select({ isActive: users.isActive }).from(users).where(eq(users.id, managerId));
  if (!m?.isActive) throw new AppError(400, "bad_manager", "Tanlangan menejer topilmadi yoki faol emas");
}

async function findDuplicates(
  db: DbOrTx,
  req: FastifyRequest,
  q: { phone?: string | null; aggregatorId?: string; externalDriverId?: string; excludeId?: string },
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];
  const showNames = can(req, "drivers.read_all");
  const name = (d: { id: string; firstName: string; lastName: string; managerId: string | null }) =>
    showNames || d.managerId === req.auth!.user.id ? `${d.lastName} ${d.firstName}` : "Boshqa menejerning haydovchisi";

  const phone = q.phone ? normalizeUzPhone(q.phone) : null;
  if (phone) {
    const rows = await db
      .select({
        id: drivers.id,
        firstName: drivers.firstName,
        lastName: drivers.lastName,
        managerId: drivers.managerId,
        archivedAt: drivers.archivedAt,
      })
      .from(drivers)
      .where(and(eq(drivers.phone, phone), q.excludeId ? ne(drivers.id, q.excludeId) : undefined));
    for (const d of rows) matches.push({ field: "phone", driver: { id: d.id, fullName: name(d), archived: !!d.archivedAt } });
  }
  if (q.aggregatorId && q.externalDriverId) {
    const rows = await db
      .select({
        id: drivers.id,
        firstName: drivers.firstName,
        lastName: drivers.lastName,
        managerId: drivers.managerId,
        archivedAt: drivers.archivedAt,
      })
      .from(aggregatorDriverAccounts)
      .innerJoin(drivers, eq(drivers.id, aggregatorDriverAccounts.driverId))
      .where(
        and(
          eq(aggregatorDriverAccounts.aggregatorId, q.aggregatorId),
          eq(aggregatorDriverAccounts.externalDriverId, q.externalDriverId),
          q.excludeId ? ne(drivers.id, q.excludeId) : undefined,
        ),
      );
    for (const d of rows)
      matches.push({ field: "externalDriverId", driver: { id: d.id, fullName: name(d), archived: !!d.archivedAt } });
  }
  return matches;
}

/**
 * Closes the driver's open vehicle assignment, if any. Uses the transaction's
 * now(), the same instant a new assignment's default start gets, so a
 * close-then-reassign in one transaction never overlaps.
 */
async function closeAssignment(tx: Tx, driverId: string) {
  return tx
    .update(driverVehicleAssignments)
    .set({ assignedTo: sql`now()` })
    .where(and(eq(driverVehicleAssignments.driverId, driverId), isNull(driverVehicleAssignments.assignedTo)))
    .returning({ vehicleId: driverVehicleAssignments.vehicleId });
}

export const driverRoutes: FastifyPluginAsync = async (app) => {
  const canRead = app.requireAnyPermission("drivers.read_all", "drivers.read_assigned");
  const canWrite = app.requirePermission("drivers.write");
  // Vehicles and other people's drivers are only visible with read_all.
  const canWriteAll = app.requirePermission("drivers.write", "drivers.read_all");

  const detail = (req: FastifyRequest, id: string, db: DbOrTx = app.db) =>
    getDriverDetail(db, id, driverScope(req), { showPii: can(req, "drivers.pii.read") });

  app.get("/", { preHandler: canRead }, async (req) => {
    const q = parseInput(driverListQuerySchema, req.query);
    return listDrivers(app.db, q, driverScope(req));
  });

  app.get("/duplicates", { preHandler: canRead }, async (req) => {
    const q = parseInput(duplicateQuery, req.query);
    return { matches: await findDuplicates(app.db, req, q) };
  });

  app.get("/:id", { preHandler: canRead }, async (req) => {
    const { id } = parseInput(idParams, req.params);
    const d = await detail(req, id);
    if (!d) throw notFound("Haydovchi");
    return d;
  });

  app.post("/", { preHandler: [canRead, canWrite] }, async (req, reply) => {
    const input = parseInput(createDriverSchema, req.body);
    if (input.passportNumber && !can(req, "drivers.pii.read")) throw forbidden();
    // Without read_all a new driver can only be assigned to the creator.
    const managerId = can(req, "drivers.read_all") ? input.managerId : req.auth!.user.id;
    await assertManager(app.db, managerId);

    try {
      const id = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(drivers)
          .values({
            ...input,
            managerId,
            registeredOn: input.registeredOn ?? sql`(now() at time zone 'Asia/Tashkent')::date`,
            createdBy: req.auth!.user.id,
          })
          .returning();
        await tx.insert(driverStatusHistory).values({
          driverId: row!.id,
          fromStatus: null,
          toStatus: row!.crmStatus,
          changedBy: req.auth!.user.id,
        });
        await writeAudit(tx, req, { action: "driver.create", entityType: "driver", entityId: row!.id, after: row });
        return row!.id;
      });
      return reply.status(201).send(await detail(req, id));
    } catch (err) {
      if (isUniqueViolation(err, "drivers_phone_active_uq")) {
        throw conflict("Bu telefon raqami boshqa faol haydovchida bor", {
          matches: await findDuplicates(app.db, req, { phone: input.phone }),
        });
      }
      throw err;
    }
  });

  app.patch("/:id", { preHandler: [canRead, canWrite] }, async (req) => {
    const { id } = parseInput(idParams, req.params);
    const input = parseInput(updateDriverSchema, req.body);
    if (input.passportNumber !== undefined && !can(req, "drivers.pii.read")) throw forbidden();
    if (input.managerId !== undefined && !can(req, "drivers.read_all")) throw forbidden();
    if (input.managerId) await assertManager(app.db, input.managerId);

    try {
      await app.db.transaction(async (tx) => {
        const before = await lockDriver(tx, req, id);
        assertNotArchived(before);
        const [after] = await tx.update(drivers).set(input).where(eq(drivers.id, id)).returning();
        await writeAudit(tx, req, { action: "driver.update", entityType: "driver", entityId: id, before, after });
      });
    } catch (err) {
      if (isUniqueViolation(err, "drivers_phone_active_uq")) {
        throw conflict("Bu telefon raqami boshqa faol haydovchida bor", {
          matches: await findDuplicates(app.db, req, { phone: input.phone ?? null, excludeId: id }),
        });
      }
      throw err;
    }
    return detail(req, id);
  });

  app.post("/:id/status", { preHandler: [canRead, canWrite] }, async (req) => {
    const { id } = parseInput(idParams, req.params);
    const input = parseInput(changeStatusSchema, req.body);
    await app.db.transaction(async (tx) => {
      const before = await lockDriver(tx, req, id);
      assertNotArchived(before);
      if (before.crmStatus === input.status) {
        throw new AppError(400, "same_status", "Haydovchi allaqachon shu holatda");
      }
      await tx.update(drivers).set({ crmStatus: input.status }).where(eq(drivers.id, id));
      await tx.insert(driverStatusHistory).values({
        driverId: id,
        fromStatus: before.crmStatus,
        toStatus: input.status,
        reason: input.reason,
        changedBy: req.auth!.user.id,
      });
      await writeAudit(tx, req, {
        action: "driver.status_change",
        entityType: "driver",
        entityId: id,
        before: { crmStatus: before.crmStatus },
        after: { crmStatus: input.status, reason: input.reason },
      });
    });
    return detail(req, id);
  });

  app.post("/:id/archive", { preHandler: [canRead, canWrite] }, async (req) => {
    const { id } = parseInput(idParams, req.params);
    const { reason } = parseInput(archiveSchema, req.body);
    await app.db.transaction(async (tx) => {
      const before = await lockDriver(tx, req, id);
      assertNotArchived(before);
      await tx.update(drivers).set({ archivedAt: new Date() }).where(eq(drivers.id, id));
      const closed = await closeAssignment(tx, id);
      await writeAudit(tx, req, {
        action: "driver.archive",
        entityType: "driver",
        entityId: id,
        after: { reason, closedVehicleAssignments: closed.length },
      });
    });
    return detail(req, id);
  });

  app.post("/:id/unarchive", { preHandler: [canRead, canWrite] }, async (req) => {
    const { id } = parseInput(idParams, req.params);
    try {
      await app.db.transaction(async (tx) => {
        const before = await lockDriver(tx, req, id);
        if (!before.archivedAt) throw new AppError(409, "not_archived", "Haydovchi arxivda emas");
        await tx.update(drivers).set({ archivedAt: null }).where(eq(drivers.id, id));
        await writeAudit(tx, req, { action: "driver.unarchive", entityType: "driver", entityId: id });
      });
    } catch (err) {
      if (isUniqueViolation(err, "drivers_phone_active_uq")) {
        throw conflict("Bu telefon raqami hozir boshqa faol haydovchida. Avval raqamni o'zgartiring");
      }
      throw err;
    }
    return detail(req, id);
  });

  app.post("/:id/accounts", { preHandler: [canRead, canWrite] }, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    const input = parseInput(linkAccountSchema, req.body);
    try {
      await app.db.transaction(async (tx) => {
        const driver = await lockDriver(tx, req, id);
        assertNotArchived(driver);
        const [agg] = await tx.select().from(aggregators).where(eq(aggregators.id, input.aggregatorId));
        if (!agg) throw new AppError(400, "bad_aggregator", "Agregator topilmadi");

        const [existing] = await tx
          .select()
          .from(aggregatorDriverAccounts)
          .where(
            and(
              eq(aggregatorDriverAccounts.aggregatorId, input.aggregatorId),
              eq(aggregatorDriverAccounts.externalDriverId, input.externalDriverId),
            ),
          )
          .for("update");
        if (existing && existing.driverId !== id) {
          throw conflict("Bu agregator ID boshqa haydovchiga bog'langan", {
            matches: await findDuplicates(tx, req, { ...input, excludeId: id }),
          });
        }
        if (existing && !existing.unlinkedAt) {
          throw conflict("Bu ID allaqachon shu haydovchiga bog'langan");
        }
        const [row] = existing
          ? await tx
              .update(aggregatorDriverAccounts)
              .set({ unlinkedAt: null, linkedAt: new Date(), externalStatus: input.externalStatus })
              .where(eq(aggregatorDriverAccounts.id, existing.id))
              .returning()
          : await tx
              .insert(aggregatorDriverAccounts)
              .values({ ...input, driverId: id })
              .returning();
        await writeAudit(tx, req, {
          action: "driver.account_link",
          entityType: "driver",
          entityId: id,
          after: { aggregator: agg.code, externalDriverId: row!.externalDriverId, accountId: row!.id },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err, "ada_driver_live_uq")) {
        throw conflict("Haydovchining bu agregatorda faol ID'si bor. Avval uni uzing");
      }
      if (isUniqueViolation(err, "ada_external_uq")) {
        throw conflict("Bu agregator ID boshqa haydovchiga bog'langan");
      }
      throw err;
    }
    return reply.status(201).send(await detail(req, id));
  });

  app.post("/:id/accounts/:accountId/unlink", { preHandler: [canRead, canWrite] }, async (req) => {
    const { id, accountId } = parseInput(accountParams, req.params);
    await app.db.transaction(async (tx) => {
      await lockDriver(tx, req, id);
      const [row] = await tx
        .update(aggregatorDriverAccounts)
        .set({ unlinkedAt: new Date() })
        .where(
          and(
            eq(aggregatorDriverAccounts.id, accountId),
            eq(aggregatorDriverAccounts.driverId, id),
            isNull(aggregatorDriverAccounts.unlinkedAt),
          ),
        )
        .returning();
      if (!row) throw notFound("Faol agregator hisobi");
      await writeAudit(tx, req, {
        action: "driver.account_unlink",
        entityType: "driver",
        entityId: id,
        before: { accountId, externalDriverId: row.externalDriverId },
      });
    });
    return detail(req, id);
  });

  app.put("/:id/vehicle", { preHandler: canWriteAll }, async (req) => {
    const { id } = parseInput(idParams, req.params);
    const { vehicleId } = parseInput(assignVehicleSchema, req.body);
    try {
      await app.db.transaction(async (tx) => {
        const driver = await lockDriver(tx, req, id);
        assertNotArchived(driver);
        const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, vehicleId)).for("update");
        if (!vehicle || vehicle.archivedAt) throw new AppError(400, "bad_vehicle", "Avtomobil topilmadi yoki arxivda");
        const [taken] = await tx
          .select({ driverId: driverVehicleAssignments.driverId })
          .from(driverVehicleAssignments)
          .where(and(eq(driverVehicleAssignments.vehicleId, vehicleId), isNull(driverVehicleAssignments.assignedTo)));
        if (taken && taken.driverId !== id) {
          throw conflict("Bu avtomobil boshqa haydovchiga biriktirilgan. Avval o'sha yerdan bo'shating");
        }
        if (taken) return;
        const closed = await closeAssignment(tx, id);
        await tx.insert(driverVehicleAssignments).values({ driverId: id, vehicleId, createdBy: req.auth!.user.id });
        await writeAudit(tx, req, {
          action: "driver.vehicle_assign",
          entityType: "driver",
          entityId: id,
          before: closed[0] ? { vehicleId: closed[0].vehicleId } : null,
          after: { vehicleId, plateNumber: vehicle.plateNumber },
        });
      });
    } catch (err) {
      if (isExclusionViolation(err)) throw conflict("Avtomobil yoki haydovchi bir vaqtda boshqa joyga biriktirildi");
      throw err;
    }
    return detail(req, id);
  });

  app.delete("/:id/vehicle", { preHandler: canWriteAll }, async (req) => {
    const { id } = parseInput(idParams, req.params);
    await app.db.transaction(async (tx) => {
      await lockDriver(tx, req, id);
      const closed = await closeAssignment(tx, id);
      if (closed.length === 0) throw notFound("Biriktirilgan avtomobil");
      await writeAudit(tx, req, {
        action: "driver.vehicle_unassign",
        entityType: "driver",
        entityId: id,
        before: { vehicleId: closed[0]!.vehicleId },
      });
    });
    return detail(req, id);
  });
};
