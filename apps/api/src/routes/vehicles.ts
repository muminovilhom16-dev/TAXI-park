import { and, asc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { normalizePlate, paginationSchema, updateVehicleSchema, vehicleSchema, type Paginated, type VehicleRow } from "@taxi/shared";
import { driverVehicleAssignments, drivers, vehicles } from "../db/schema/index.js";
import { writeAudit } from "../lib/audit.js";
import { AppError, conflict, isUniqueViolation, notFound, parseInput } from "../lib/errors.js";
import { containsPattern } from "../lib/sql.js";

const idParams = z.object({ id: z.string().uuid() });
const listQuery = paginationSchema.extend({
  q: z.string().trim().max(60).optional(),
  archived: z.enum(["true", "false", "all"]).default("false"),
  assigned: z.enum(["true", "false"]).optional(),
});

export const vehicleRoutes: FastifyPluginAsync = async (app) => {
  const canRead = app.requirePermission("drivers.read_all");
  const canWrite = app.requirePermission("drivers.read_all", "drivers.write");

  const openAssignment = sql`exists (select 1 from ${driverVehicleAssignments} d where d.vehicle_id = ${vehicles.id} and d.assigned_to is null)`;

  async function load(where: ReturnType<typeof and>, page = 1, pageSize = 100): Promise<Paginated<VehicleRow>> {
    const [rows, [total]] = await Promise.all([
      app.db
        .select({
          id: vehicles.id,
          plateNumber: vehicles.plateNumber,
          make: vehicles.make,
          model: vehicles.model,
          year: vehicles.year,
          color: vehicles.color,
          note: vehicles.note,
          archivedAt: vehicles.archivedAt,
          driverId: drivers.id,
          driverFirst: drivers.firstName,
          driverLast: drivers.lastName,
        })
        .from(vehicles)
        .leftJoin(
          driverVehicleAssignments,
          and(eq(driverVehicleAssignments.vehicleId, vehicles.id), isNull(driverVehicleAssignments.assignedTo)),
        )
        .leftJoin(drivers, eq(drivers.id, driverVehicleAssignments.driverId))
        .where(where)
        .orderBy(asc(vehicles.plateNumber))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      app.db.select({ n: sql<number>`count(*)::int` }).from(vehicles).where(where),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        plateNumber: r.plateNumber,
        make: r.make,
        model: r.model,
        year: r.year,
        color: r.color,
        note: r.note,
        archivedAt: r.archivedAt?.toISOString() ?? null,
        driver: r.driverId ? { id: r.driverId, fullName: `${r.driverLast} ${r.driverFirst}` } : null,
      })),
      total: total?.n ?? 0,
      page,
      pageSize,
    };
  }

  app.get("/", { preHandler: canRead }, async (req) => {
    const q = parseInput(listQuery, req.query);
    const where = and(
      q.q
        ? or(
            ilike(vehicles.plateNumber, containsPattern(normalizePlate(q.q))),
            ilike(vehicles.model, containsPattern(q.q)),
            ilike(vehicles.make, containsPattern(q.q)),
          )
        : undefined,
      q.archived === "false" ? isNull(vehicles.archivedAt) : q.archived === "true" ? isNotNull(vehicles.archivedAt) : undefined,
      q.assigned === "true" ? openAssignment : q.assigned === "false" ? sql`not ${openAssignment}` : undefined,
    );
    return load(where, q.page, q.pageSize);
  });

  app.post("/", { preHandler: canWrite }, async (req, reply) => {
    const input = parseInput(vehicleSchema, req.body);
    try {
      const row = await app.db.transaction(async (tx) => {
        const [created] = await tx.insert(vehicles).values(input).returning();
        await writeAudit(tx, req, { action: "vehicle.create", entityType: "vehicle", entityId: created!.id, after: created });
        return created!;
      });
      return reply.status(201).send(row);
    } catch (err) {
      if (isUniqueViolation(err, "vehicles_plate_active_uq")) throw conflict("Bu davlat raqamli avtomobil allaqachon bor");
      throw err;
    }
  });

  app.patch("/:id", { preHandler: canWrite }, async (req) => {
    const { id } = parseInput(idParams, req.params);
    const input = parseInput(updateVehicleSchema, req.body);
    try {
      return await app.db.transaction(async (tx) => {
        const [before] = await tx.select().from(vehicles).where(eq(vehicles.id, id)).for("update");
        if (!before) throw notFound("Avtomobil");
        if (before.archivedAt) throw new AppError(409, "archived", "Avtomobil arxivda");
        const [after] = await tx.update(vehicles).set(input).where(eq(vehicles.id, id)).returning();
        await writeAudit(tx, req, { action: "vehicle.update", entityType: "vehicle", entityId: id, before, after });
        return after;
      });
    } catch (err) {
      if (isUniqueViolation(err, "vehicles_plate_active_uq")) throw conflict("Bu davlat raqamli avtomobil allaqachon bor");
      throw err;
    }
  });

  app.post("/:id/archive", { preHandler: canWrite }, async (req) => {
    const { id } = parseInput(idParams, req.params);
    return app.db.transaction(async (tx) => {
      const [before] = await tx.select().from(vehicles).where(eq(vehicles.id, id)).for("update");
      if (!before) throw notFound("Avtomobil");
      if (before.archivedAt) throw new AppError(409, "archived", "Avtomobil allaqachon arxivda");
      const [open] = await tx
        .select({ id: driverVehicleAssignments.id })
        .from(driverVehicleAssignments)
        .where(and(eq(driverVehicleAssignments.vehicleId, id), isNull(driverVehicleAssignments.assignedTo)));
      if (open) throw conflict("Avtomobil haydovchiga biriktirilgan. Avval bo'shating");
      const [after] = await tx.update(vehicles).set({ archivedAt: new Date() }).where(eq(vehicles.id, id)).returning();
      await writeAudit(tx, req, { action: "vehicle.archive", entityType: "vehicle", entityId: id });
      return after;
    });
  });
};
