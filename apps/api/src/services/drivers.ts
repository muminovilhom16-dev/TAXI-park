import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type {
  CrmStatus,
  DriverAccount,
  DriverDetail,
  DriverListItem,
  driverListQuerySchema,
  LicenseStatus,
  VehicleRef,
} from "@taxi/shared";
import type { DbOrTx } from "../db/client.js";
import {
  aggregatorDriverAccounts,
  aggregators,
  driverStatusHistory,
  driverVehicleAssignments,
  drivers,
  users,
  vehicles,
} from "../db/schema/index.js";
import { containsPattern } from "../lib/sql.js";

const manager = alias(users, "manager");

const iso = (d: Date | null) => (d ? d.toISOString() : null);

type ListQuery = z.infer<typeof driverListQuerySchema>;

function listFilters(q: ListQuery, scope: SQL | undefined): SQL | undefined {
  const term = q.q?.trim();
  const digits = term?.replace(/\D/g, "") ?? "";
  const plate = term?.toUpperCase().replace(/[\s-]/g, "") ?? "";
  const search = term
    ? or(
        ilike(drivers.firstName, containsPattern(term)),
        ilike(drivers.lastName, containsPattern(term)),
        ilike(sql`(${drivers.lastName} || ' ' || ${drivers.firstName})`, containsPattern(term)),
        ilike(sql`(${drivers.firstName} || ' ' || ${drivers.lastName})`, containsPattern(term)),
        digits.length >= 3 ? ilike(drivers.phone, containsPattern(digits)) : undefined,
        sql`exists (select 1 from ${driverVehicleAssignments} dva join ${vehicles} v on v.id = dva.vehicle_id
              where dva.driver_id = ${drivers.id} and dva.assigned_to is null
              and v.plate_number like ${containsPattern(plate)})`,
        sql`exists (select 1 from ${aggregatorDriverAccounts} a
              where a.driver_id = ${drivers.id} and a.external_driver_id ilike ${containsPattern(term)})`,
      )
    : undefined;

  return and(
    scope,
    search,
    q.status ? eq(drivers.crmStatus, q.status) : undefined,
    q.licenseStatus ? eq(drivers.licenseStatus, q.licenseStatus) : undefined,
    q.manager === "none" ? isNull(drivers.managerId) : q.manager ? eq(drivers.managerId, q.manager) : undefined,
    q.aggregatorId
      ? sql`exists (select 1 from ${aggregatorDriverAccounts} a
              where a.driver_id = ${drivers.id} and a.aggregator_id = ${q.aggregatorId} and a.unlinked_at is null)`
      : undefined,
    q.archived === "false" ? isNull(drivers.archivedAt) : q.archived === "true" ? isNotNull(drivers.archivedAt) : undefined,
  );
}

function orderBy(q: ListQuery): SQL[] {
  const dir = q.dir === "desc" ? desc : asc;
  switch (q.sort) {
    case "registeredOn":
      return [dir(drivers.registeredOn), asc(drivers.lastName)];
    case "createdAt":
      return [dir(drivers.createdAt)];
    case "status":
      return [dir(drivers.crmStatus), asc(drivers.lastName)];
    default:
      return [dir(drivers.lastName), dir(drivers.firstName), asc(drivers.id)];
  }
}

async function currentVehicles(db: DbOrTx, ids: string[]) {
  if (ids.length === 0) return new Map<string, VehicleRef>();
  const rows = await db
    .select({
      driverId: driverVehicleAssignments.driverId,
      id: vehicles.id,
      plateNumber: vehicles.plateNumber,
      make: vehicles.make,
      model: vehicles.model,
    })
    .from(driverVehicleAssignments)
    .innerJoin(vehicles, eq(vehicles.id, driverVehicleAssignments.vehicleId))
    .where(and(inArray(driverVehicleAssignments.driverId, ids), isNull(driverVehicleAssignments.assignedTo)));
  return new Map(rows.map(({ driverId, ...v }) => [driverId, v]));
}

async function liveAccounts(db: DbOrTx, ids: string[]) {
  const map = new Map<string, { aggregatorName: string; externalDriverId: string }[]>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({
      driverId: aggregatorDriverAccounts.driverId,
      aggregatorName: aggregators.name,
      externalDriverId: aggregatorDriverAccounts.externalDriverId,
    })
    .from(aggregatorDriverAccounts)
    .innerJoin(aggregators, eq(aggregators.id, aggregatorDriverAccounts.aggregatorId))
    .where(and(inArray(aggregatorDriverAccounts.driverId, ids), isNull(aggregatorDriverAccounts.unlinkedAt)))
    .orderBy(asc(aggregators.name));
  for (const { driverId, ...a } of rows) map.set(driverId, [...(map.get(driverId) ?? []), a]);
  return map;
}

const baseColumns = {
  id: drivers.id,
  firstName: drivers.firstName,
  lastName: drivers.lastName,
  phone: drivers.phone,
  crmStatus: drivers.crmStatus,
  licenseStatus: drivers.licenseStatus,
  registeredOn: drivers.registeredOn,
  archivedAt: drivers.archivedAt,
  managerId: manager.id,
  managerName: manager.fullName,
};

type BaseRow = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  crmStatus: CrmStatus;
  licenseStatus: LicenseStatus;
  registeredOn: string;
  archivedAt: Date | null;
  managerId: string | null;
  managerName: string | null;
};

function toListItem(
  r: BaseRow,
  vehicle: VehicleRef | undefined,
  accounts: DriverListItem["accounts"] | undefined,
): DriverListItem {
  return {
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    phone: r.phone,
    crmStatus: r.crmStatus,
    licenseStatus: r.licenseStatus,
    registeredOn: r.registeredOn,
    manager: r.managerId ? { id: r.managerId, fullName: r.managerName ?? "" } : null,
    vehicle: vehicle ?? null,
    accounts: accounts ?? [],
    archivedAt: iso(r.archivedAt),
  };
}

export async function listDrivers(db: DbOrTx, q: ListQuery, scope: SQL | undefined) {
  const where = listFilters(q, scope);
  const [rows, [total]] = await Promise.all([
    db
      .select(baseColumns)
      .from(drivers)
      .leftJoin(manager, eq(manager.id, drivers.managerId))
      .where(where)
      .orderBy(...orderBy(q))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(drivers).where(where),
  ]);
  const ids = rows.map((r) => r.id);
  const [veh, acc] = await Promise.all([currentVehicles(db, ids), liveAccounts(db, ids)]);
  return {
    items: rows.map((r) => toListItem(r, veh.get(r.id), acc.get(r.id))),
    total: total?.n ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  };
}

/** Returns the driver if the caller's scope allows it, else undefined (callers answer 404). */
export async function getDriverDetail(
  db: DbOrTx,
  id: string,
  scope: SQL | undefined,
  opts: { showPii: boolean },
): Promise<DriverDetail | undefined> {
  const [row] = await db
    .select({
      ...baseColumns,
      extraContact: drivers.extraContact,
      passportNumber: drivers.passportNumber,
      licenseNumber: drivers.licenseNumber,
      licenseExpiresOn: drivers.licenseExpiresOn,
      note: drivers.note,
      createdAt: drivers.createdAt,
      updatedAt: drivers.updatedAt,
    })
    .from(drivers)
    .leftJoin(manager, eq(manager.id, drivers.managerId))
    .where(and(eq(drivers.id, id), scope));
  if (!row) return undefined;

  const changedBy = alias(users, "changed_by");
  const [history, vehicleRows, accountRows] = await Promise.all([
    db
      .select({
        id: driverStatusHistory.id,
        fromStatus: driverStatusHistory.fromStatus,
        toStatus: driverStatusHistory.toStatus,
        reason: driverStatusHistory.reason,
        createdAt: driverStatusHistory.createdAt,
        byId: changedBy.id,
        byName: changedBy.fullName,
      })
      .from(driverStatusHistory)
      .leftJoin(changedBy, eq(changedBy.id, driverStatusHistory.changedBy))
      .where(eq(driverStatusHistory.driverId, id))
      .orderBy(desc(driverStatusHistory.id)),
    db
      .select({
        id: driverVehicleAssignments.id,
        assignedFrom: driverVehicleAssignments.assignedFrom,
        assignedTo: driverVehicleAssignments.assignedTo,
        vehicleId: vehicles.id,
        plateNumber: vehicles.plateNumber,
        make: vehicles.make,
        model: vehicles.model,
      })
      .from(driverVehicleAssignments)
      .innerJoin(vehicles, eq(vehicles.id, driverVehicleAssignments.vehicleId))
      .where(eq(driverVehicleAssignments.driverId, id))
      .orderBy(desc(driverVehicleAssignments.assignedFrom)),
    db
      .select({
        id: aggregatorDriverAccounts.id,
        aggregatorId: aggregators.id,
        aggregatorCode: aggregators.code,
        aggregatorName: aggregators.name,
        externalDriverId: aggregatorDriverAccounts.externalDriverId,
        externalStatus: aggregatorDriverAccounts.externalStatus,
        linkedAt: aggregatorDriverAccounts.linkedAt,
        unlinkedAt: aggregatorDriverAccounts.unlinkedAt,
      })
      .from(aggregatorDriverAccounts)
      .innerJoin(aggregators, eq(aggregators.id, aggregatorDriverAccounts.aggregatorId))
      .where(eq(aggregatorDriverAccounts.driverId, id))
      .orderBy(desc(aggregatorDriverAccounts.linkedAt)),
  ]);

  const allAccounts: DriverAccount[] = accountRows.map((a) => ({
    id: a.id,
    aggregator: { id: a.aggregatorId, code: a.aggregatorCode, name: a.aggregatorName },
    externalDriverId: a.externalDriverId,
    externalStatus: a.externalStatus,
    linkedAt: a.linkedAt.toISOString(),
    unlinkedAt: iso(a.unlinkedAt),
  }));
  const open = vehicleRows.find((v) => v.assignedTo === null);

  return {
    ...toListItem(
      row,
      open ? { id: open.vehicleId, plateNumber: open.plateNumber, make: open.make, model: open.model } : undefined,
      allAccounts
        .filter((a) => !a.unlinkedAt)
        .map((a) => ({ aggregatorName: a.aggregator.name, externalDriverId: a.externalDriverId })),
    ),
    extraContact: row.extraContact,
    passportNumber: opts.showPii ? row.passportNumber : null,
    piiHidden: !opts.showPii,
    licenseNumber: row.licenseNumber,
    licenseExpiresOn: row.licenseExpiresOn,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    statusHistory: history.map((h) => ({
      id: h.id.toString(),
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      reason: h.reason,
      changedBy: h.byId ? { id: h.byId, fullName: h.byName ?? "" } : null,
      createdAt: h.createdAt.toISOString(),
    })),
    vehicleHistory: vehicleRows.map((v) => ({
      id: v.id,
      vehicle: { id: v.vehicleId, plateNumber: v.plateNumber, make: v.make, model: v.model },
      assignedFrom: v.assignedFrom.toISOString(),
      assignedTo: iso(v.assignedTo),
    })),
    allAccounts,
  };
}
