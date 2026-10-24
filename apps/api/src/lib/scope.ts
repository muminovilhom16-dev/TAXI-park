import { eq, type SQL } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { Permission } from "@taxi/shared";
import { drivers } from "../db/schema/index.js";
import { forbidden, unauthorized } from "./errors.js";

/**
 * Row filter for the drivers the caller may see: everything with
 * drivers.read_all, only their own with drivers.read_assigned.
 * Returns undefined for "no restriction".
 */
export function driverScope(req: FastifyRequest): SQL | undefined {
  const auth = req.auth;
  if (!auth) throw unauthorized();
  const perms = auth.user.permissions;
  if (perms.includes("drivers.read_all")) return undefined;
  if (perms.includes("drivers.read_assigned")) return eq(drivers.managerId, auth.user.id);
  throw forbidden();
}

export function can(req: FastifyRequest, perm: Permission): boolean {
  return !!req.auth?.user.permissions.includes(perm);
}
