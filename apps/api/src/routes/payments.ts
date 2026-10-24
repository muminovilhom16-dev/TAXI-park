import { aliasedTable, and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { paymentCreateSchema, paymentListQuerySchema, voidSchema, type PaymentRow } from "@taxi/shared";
import type { Tx } from "../db/client.js";
import { appSettings, drivers, financialTransactions, users } from "../db/schema/index.js";
import { writeAudit } from "../lib/audit.js";
import { AppError, conflict, forbidden, notFound, parseInput } from "../lib/errors.js";

const idParams = z.object({ id: z.string().uuid() });
const PAYMENT_TYPES = ["driver_other_payment_in", "adjustment"] as const;

// Driver payments toward their debt. A payment counts only once approved, by
// someone other than the person who entered it when the setting says so.
export const paymentRoutes: FastifyPluginAsync = async (app) => {
  const canRead = app.requirePermission("finance.read");
  const canWrite = app.requirePermission("payments.write");
  const canApprove = app.requirePermission("payments.approve");

  async function lockPayment(tx: Tx, id: string) {
    const [row] = await tx
      .select()
      .from(financialTransactions)
      .where(and(eq(financialTransactions.id, id), inArray(financialTransactions.type, [...PAYMENT_TYPES])))
      .for("update");
    if (!row) throw notFound("To'lov");
    return row;
  }

  async function assertSeparateApprover(tx: Tx, req: FastifyRequest, createdBy: string) {
    const [s] = await tx.select().from(appSettings).where(eq(appSettings.key, "finance.require_separate_approver"));
    if (s?.value !== false && createdBy === req.auth!.user.id) {
      throw new AppError(403, "same_approver", "O'zingiz kiritgan to'lovni boshqa xodim tasdiqlashi kerak");
    }
  }

  app.get("/", { preHandler: canRead }, async (req): Promise<{ items: PaymentRow[]; total: number }> => {
    const q = parseInput(paymentListQuerySchema, req.query);
    const creator = aliasedTable(users, "creator");
    const where = and(
      inArray(financialTransactions.type, [...PAYMENT_TYPES]),
      q.status === "all" ? undefined : eq(financialTransactions.approvalStatus, q.status),
      q.driverId ? eq(financialTransactions.driverId, q.driverId) : undefined,
    );
    const rows = await app.db
        .select({
          t: financialTransactions,
          driverFirst: drivers.firstName,
          driverLast: drivers.lastName,
          creatorName: creator.fullName,
          approverName: sql<string | null>`(select u.full_name from users u where u.id = ${financialTransactions.approvedBy})`,
          reversed: sql<boolean>`exists (select 1 from financial_transactions r where r.reverses_transaction_id = ${financialTransactions.id})`,
        })
        .from(financialTransactions)
        .leftJoin(drivers, eq(drivers.id, financialTransactions.driverId))
        .innerJoin(creator, eq(creator.id, financialTransactions.createdBy))
        .where(where)
        .orderBy(desc(financialTransactions.occurredAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
    const [total] = await app.db.select({ n: count() }).from(financialTransactions).where(where);
    return {
      items: rows.map((r) => ({
        id: r.t.id,
        type: r.t.type as PaymentRow["type"],
        direction: r.t.direction,
        amount: r.t.amount,
        paymentMethod: r.t.paymentMethod,
        occurredAt: r.t.occurredAt.toISOString(),
        driver: r.t.driverId ? { id: r.t.driverId, fullName: `${r.driverLast} ${r.driverFirst}` } : null,
        approvalStatus: r.t.approvalStatus,
        createdBy: { id: r.t.createdBy, fullName: r.creatorName },
        approvedBy: r.approverName,
        reversesTransactionId: r.t.reversesTransactionId,
        reversed: r.reversed,
        note: r.t.note,
      })),
      total: total?.n ?? 0,
    };
  });

  app.post("/", { preHandler: canWrite }, async (req, reply) => {
    const input = parseInput(paymentCreateSchema, req.body);
    const [driver] = await app.db.select({ id: drivers.id }).from(drivers).where(eq(drivers.id, input.driverId));
    if (!driver) throw notFound("Haydovchi");
    const result = await app.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(financialTransactions)
        .values({
          type: "driver_other_payment_in",
          direction: "in",
          amount: input.amount,
          occurredAt: new Date(),
          paymentMethod: input.paymentMethod,
          driverId: input.driverId,
          idempotencyKey: input.idempotencyKey,
          note: input.note ?? null,
          createdBy: req.auth!.user.id,
        })
        .onConflictDoNothing({ target: financialTransactions.idempotencyKey })
        .returning();
      if (!row) {
        // Same form submitted twice: return the first one, but only if it really is the same.
        const [prev] = await tx
          .select()
          .from(financialTransactions)
          .where(eq(financialTransactions.idempotencyKey, input.idempotencyKey));
        if (!prev || prev.driverId !== input.driverId || prev.amount !== input.amount || prev.createdBy !== req.auth!.user.id) {
          throw conflict("Bu so'rov kaliti boshqa to'lovda ishlatilgan");
        }
        return { row: prev, created: false };
      }
      await writeAudit(tx, req, { action: "payment.create", entityType: "transaction", entityId: row.id, after: row });
      return { row, created: true };
    });
    return reply.status(result.created ? 201 : 200).send(result.row);
  });

  for (const [path, status] of [
    ["approve", "approved"],
    ["reject", "rejected"],
  ] as const) {
    app.post(`/:id/${path}`, { preHandler: canApprove }, async (req) => {
      const { id } = parseInput(idParams, req.params);
      return app.db.transaction(async (tx) => {
        const row = await lockPayment(tx, id);
        if (row.approvalStatus !== "pending") throw conflict("To'lov allaqachon ko'rib chiqilgan");
        await assertSeparateApprover(tx, req, row.createdBy);
        const [after] = await tx
          .update(financialTransactions)
          .set({ approvalStatus: status, approvedBy: req.auth!.user.id, approvedAt: sql`now()` })
          .where(eq(financialTransactions.id, id))
          .returning();
        await writeAudit(tx, req, { action: `payment.${path}`, entityType: "transaction", entityId: id, before: row, after });
        return after;
      });
    });
  }

  // An approved payment is never edited: a reversal puts the same amount back on the debt.
  app.post("/:id/reverse", { preHandler: canApprove }, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    const { reason } = parseInput(voidSchema, req.body);
    const result = await app.db.transaction(async (tx) => {
      const row = await lockPayment(tx, id);
      if (row.type !== "driver_other_payment_in") throw forbidden();
      if (row.approvalStatus !== "approved") {
        throw conflict("Faqat tasdiqlangan to'lovni bekor qilish mumkin. Kutilayotganini rad eting");
      }
      const [existing] = await tx
        .select({ id: financialTransactions.id })
        .from(financialTransactions)
        .where(eq(financialTransactions.reversesTransactionId, id));
      if (existing) throw conflict("Bu to'lov allaqachon bekor qilingan");
      const [rev] = await tx
        .insert(financialTransactions)
        .values({
          type: "adjustment",
          direction: "out",
          amount: row.amount,
          occurredAt: new Date(),
          paymentMethod: row.paymentMethod,
          driverId: row.driverId,
          idempotencyKey: `reversal:${id}`,
          approvalStatus: "approved",
          approvedBy: req.auth!.user.id,
          approvedAt: new Date(),
          reversesTransactionId: id,
          note: reason,
          createdBy: req.auth!.user.id,
        })
        .returning();
      await writeAudit(tx, req, { action: "payment.reverse", entityType: "transaction", entityId: id, before: row, after: rev });
      return rev;
    });
    return reply.status(201).send(result);
  });
};
