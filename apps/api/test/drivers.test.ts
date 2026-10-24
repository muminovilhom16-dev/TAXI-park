import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { aggregators, auditLogs, driverStatusHistory } from "../src/db/schema/index.js";
import { as, createUser, login, resetDb, setupTestApp, type Session } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setupTestApp>>;
let owner: Session, admin: Session, manager: Session, manager2: Session, operator: Session, accountant: Session;
let managerId: string;
let aggregatorId: string;

beforeAll(async () => {
  ctx = await setupTestApp();
});
afterAll(() => ctx.teardown());
beforeEach(async () => {
  await resetDb(ctx.db);
  await createUser(ctx.db, "owner");
  await createUser(ctx.db, "admin");
  managerId = await createUser(ctx.db, "manager");
  await createUser(ctx.db, "manager", "manager2");
  await createUser(ctx.db, "operator");
  await createUser(ctx.db, "accountant");
  [owner, admin, manager, manager2, operator, accountant] = (await Promise.all(
    ["owner", "admin", "manager", "manager2", "operator", "accountant"].map((l) => login(ctx.app, l)),
  )) as [Session, Session, Session, Session, Session, Session];
  const [a] = await ctx.db.insert(aggregators).values({ code: "yandex", name: "Yandex Go" }).returning();
  aggregatorId = a!.id;
});

const driver = (over: Record<string, unknown> = {}) => ({
  firstName: "Ali",
  lastName: "Valiyev",
  phone: "+998 90 111 22 33",
  licenseStatus: "valid",
  ...over,
});

async function create(s: Session, over: Record<string, unknown> = {}) {
  const res = await as(ctx.app, s).post("/api/drivers", driver(over));
  if (res.statusCode !== 201) throw new Error(`create failed ${res.statusCode} ${res.body}`);
  return res.json();
}

describe("creating drivers", () => {
  it("normalizes the phone, starts as 'new' and records the first status", async () => {
    const d = await create(operator);
    expect(d).toMatchObject({ phone: "+998901112233", crmStatus: "new", archivedAt: null });
    expect(d.registeredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const history = await ctx.db.select().from(driverStatusHistory).where(eq(driverStatusHistory.driverId, d.id));
    expect(history).toHaveLength(1);
    expect(history[0]!.toStatus).toBe("new");
  });

  it("rejects a phone already used by an active driver, naming the match", async () => {
    const first = await create(operator);
    const res = await as(ctx.app, operator).post("/api/drivers", driver({ firstName: "Boshqa", phone: "901112233" }));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.matches[0]).toMatchObject({ field: "phone", driver: { id: first.id } });
  });

  it("validates input with field-level messages", async () => {
    const res = await as(ctx.app, operator).post("/api/drivers", driver({ phone: "123", firstName: "" }));
    expect(res.statusCode).toBe(400);
    const paths = res.json().error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["phone", "firstName"]));
  });

  it("a manager's new driver is always assigned to that manager", async () => {
    const d = await create(manager, { managerId: null });
    expect(d.manager.id).toBe(managerId);
  });

  it("only roles with PII access may store a passport number", async () => {
    const res = await as(ctx.app, operator).post("/api/drivers", driver({ passportNumber: "AA1234567" }));
    expect(res.statusCode).toBe(403);
    const ok = await as(ctx.app, admin).post("/api/drivers", driver({ passportNumber: "AA1234567" }));
    expect(ok.statusCode).toBe(201);
    expect(ok.json().passportNumber).toBe("AA1234567");
  });

  it("the accountant cannot create drivers", async () => {
    const res = await as(ctx.app, accountant).post("/api/drivers", driver());
    expect(res.statusCode).toBe(403);
  });
});

describe("visibility", () => {
  it("a manager sees only their own drivers, and others' are 404", async () => {
    const mine = await create(manager);
    const theirs = await create(manager2, { phone: "+998901112244" });
    const list = await as(ctx.app, manager).get("/api/drivers");
    expect(list.json().items.map((d: { id: string }) => d.id)).toEqual([mine.id]);
    expect((await as(ctx.app, manager).get(`/api/drivers/${theirs.id}`)).statusCode).toBe(404);
    const edit = await as(ctx.app, manager).patch(`/api/drivers/${theirs.id}`, { note: "x" });
    expect(edit.statusCode).toBe(404);
  });

  it("a manager cannot reassign a driver to someone else", async () => {
    const mine = await create(manager);
    const res = await as(ctx.app, manager).patch(`/api/drivers/${mine.id}`, { managerId: null });
    expect(res.statusCode).toBe(403);
  });

  it("hides the passport number from roles without PII access", async () => {
    const d = (await as(ctx.app, admin).post("/api/drivers", driver({ passportNumber: "AA1234567" }))).json();
    const forOperator = (await as(ctx.app, operator).get(`/api/drivers/${d.id}`)).json();
    expect(forOperator.passportNumber).toBeNull();
    expect(forOperator.piiHidden).toBe(true);
    const forList = (await as(ctx.app, operator).get("/api/drivers")).body;
    expect(forList).not.toContain("AA1234567");
  });

  it("duplicate checks do not reveal other managers' driver names", async () => {
    await create(manager2);
    const res = await as(ctx.app, manager).get("/api/drivers/duplicates?phone=901112233");
    expect(res.json().matches[0].driver.fullName).toBe("Boshqa menejerning haydovchisi");
    const forAdmin = await as(ctx.app, admin).get("/api/drivers/duplicates?phone=901112233");
    expect(forAdmin.json().matches[0].driver.fullName).toBe("Valiyev Ali");
  });
});

describe("list search, filters and sorting", () => {
  beforeEach(async () => {
    await create(operator, { firstName: "Bobur", lastName: "Aliyev", phone: "+998901000001" });
    await create(operator, { firstName: "Dilshod", lastName: "Karimov", phone: "+998901000002", managerId });
    await create(operator, { firstName: "Sardor", lastName: "Toshmatov", phone: "+998931234567" });
  });

  it("searches by name, full name and phone digits", async () => {
    const byName = await as(ctx.app, operator).get("/api/drivers?q=karim");
    expect(byName.json().items.map((d: { lastName: string }) => d.lastName)).toEqual(["Karimov"]);
    const byFull = await as(ctx.app, operator).get(`/api/drivers?q=${encodeURIComponent("Sardor Tosh")}`);
    expect(byFull.json().total).toBe(1);
    const byPhone = await as(ctx.app, operator).get("/api/drivers?q=1234567");
    expect(byPhone.json().items[0].lastName).toBe("Toshmatov");
  });

  it("filters by manager, including 'no manager'", async () => {
    const assigned = await as(ctx.app, operator).get(`/api/drivers?manager=${managerId}`);
    expect(assigned.json().total).toBe(1);
    const none = await as(ctx.app, operator).get("/api/drivers?manager=none");
    expect(none.json().total).toBe(2);
  });

  it("sorts and paginates", async () => {
    const desc = await as(ctx.app, operator).get("/api/drivers?sort=name&dir=desc&pageSize=2");
    expect(desc.json().items.map((d: { lastName: string }) => d.lastName)).toEqual(["Toshmatov", "Karimov"]);
    expect(desc.json().total).toBe(3);
    const page2 = await as(ctx.app, operator).get("/api/drivers?sort=name&dir=desc&pageSize=2&page=2");
    expect(page2.json().items.map((d: { lastName: string }) => d.lastName)).toEqual(["Aliyev"]);
  });

  it("searches by aggregator ID and filters by aggregator", async () => {
    const all = (await as(ctx.app, operator).get("/api/drivers")).json().items;
    const bobur = all.find((d: { firstName: string }) => d.firstName === "Bobur");
    await as(ctx.app, operator).post(`/api/drivers/${bobur.id}/accounts`, { aggregatorId, externalDriverId: "YX-7781" });
    expect((await as(ctx.app, operator).get("/api/drivers?q=yx-77")).json().total).toBe(1);
    expect((await as(ctx.app, operator).get(`/api/drivers?aggregatorId=${aggregatorId}`)).json().total).toBe(1);
  });
});

describe("status changes", () => {
  it("records each change with who and why", async () => {
    const d = await create(operator);
    const res = await as(ctx.app, operator).post(`/api/drivers/${d.id}/status`, { status: "active" });
    expect(res.statusCode).toBe(200);
    expect(res.json().statusHistory.map((h: { toStatus: string }) => h.toStatus)).toEqual(["active", "new"]);
    expect(res.json().statusHistory[0].changedBy.fullName).toBe("Test operator");
  });

  it("requires a reason to suspend or terminate", async () => {
    const d = await create(operator);
    const res = await as(ctx.app, operator).post(`/api/drivers/${d.id}/status`, { status: "suspended" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details[0].path).toBe("reason");
    const ok = await as(ctx.app, operator).post(`/api/drivers/${d.id}/status`, { status: "suspended", reason: "Hujjat muddati o'tgan" });
    expect(ok.statusCode).toBe(200);
  });

  it("refuses a no-op change", async () => {
    const d = await create(operator);
    expect((await as(ctx.app, operator).post(`/api/drivers/${d.id}/status`, { status: "new" })).statusCode).toBe(400);
  });
});

describe("archiving", () => {
  it("archives instead of deleting, frees the phone, and blocks edits", async () => {
    const d = await create(operator);
    const archived = await as(ctx.app, operator).post(`/api/drivers/${d.id}/archive`, { reason: "Ishdan ketdi" });
    expect(archived.json().archivedAt).not.toBeNull();
    expect((await as(ctx.app, operator).get("/api/drivers")).json().total).toBe(0);
    expect((await as(ctx.app, operator).get("/api/drivers?archived=true")).json().total).toBe(1);
    expect((await as(ctx.app, operator).patch(`/api/drivers/${d.id}`, { note: "x" })).statusCode).toBe(409);
    // The phone can be reused, and then the old record cannot come back with it.
    await create(operator, { firstName: "Yangi" });
    expect((await as(ctx.app, operator).post(`/api/drivers/${d.id}/unarchive`)).statusCode).toBe(409);
  });

});

describe("aggregator accounts", () => {
  it("links an external ID once; a second driver cannot take it", async () => {
    const a = await create(operator);
    const b = await create(operator, { phone: "+998901112299" });
    const link = await as(ctx.app, operator).post(`/api/drivers/${a.id}/accounts`, { aggregatorId, externalDriverId: "YX-1" });
    expect(link.statusCode).toBe(201);
    expect(link.json().accounts).toEqual([{ aggregatorName: "Yandex Go", externalDriverId: "YX-1" }]);
    const taken = await as(ctx.app, operator).post(`/api/drivers/${b.id}/accounts`, { aggregatorId, externalDriverId: "YX-1" });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.details.matches[0].driver.id).toBe(a.id);
  });

  it("one live account per aggregator; unlink keeps history and allows relinking", async () => {
    const a = await create(operator);
    const first = (await as(ctx.app, operator).post(`/api/drivers/${a.id}/accounts`, { aggregatorId, externalDriverId: "YX-1" })).json();
    const second = await as(ctx.app, operator).post(`/api/drivers/${a.id}/accounts`, { aggregatorId, externalDriverId: "YX-2" });
    expect(second.statusCode).toBe(409);
    const accountId = first.allAccounts[0].id;
    const unlinked = await as(ctx.app, operator).post(`/api/drivers/${a.id}/accounts/${accountId}/unlink`);
    expect(unlinked.json().accounts).toEqual([]);
    expect(unlinked.json().allAccounts[0].unlinkedAt).not.toBeNull();
    const relink = await as(ctx.app, operator).post(`/api/drivers/${a.id}/accounts`, { aggregatorId, externalDriverId: "YX-1" });
    expect(relink.statusCode).toBe(201);
    expect(relink.json().allAccounts).toHaveLength(1);
  });
});

describe("vehicles", () => {
  it("assigns a vehicle, moves the driver to another, and refuses a taken one", async () => {
    const a = await create(operator);
    const b = await create(operator, { phone: "+998901112299" });
    const v1 = (await as(ctx.app, operator).post("/api/vehicles", { plateNumber: "01 a 123 bc", model: "Cobalt" })).json();
    const v2 = (await as(ctx.app, operator).post("/api/vehicles", { plateNumber: "01B456CD", model: "Nexia" })).json();
    expect(v1.plateNumber).toBe("01A123BC");

    const assigned = await as(ctx.app, operator).put(`/api/drivers/${a.id}/vehicle`, { vehicleId: v1.id });
    expect(assigned.json().vehicle.plateNumber).toBe("01A123BC");
    const moved = (await as(ctx.app, operator).put(`/api/drivers/${a.id}/vehicle`, { vehicleId: v2.id })).json();
    expect(moved.vehicle.plateNumber).toBe("01B456CD");
    expect(moved.vehicleHistory).toHaveLength(2);
    expect(moved.vehicleHistory[1].assignedTo).not.toBeNull();

    expect((await as(ctx.app, operator).put(`/api/drivers/${b.id}/vehicle`, { vehicleId: v2.id })).statusCode).toBe(409);
    expect((await as(ctx.app, operator).put(`/api/drivers/${b.id}/vehicle`, { vehicleId: v1.id })).statusCode).toBe(200);
  });

  it("rejects duplicate and malformed plates", async () => {
    await as(ctx.app, operator).post("/api/vehicles", { plateNumber: "01A123BC", model: "Cobalt" });
    expect((await as(ctx.app, operator).post("/api/vehicles", { plateNumber: "01 A 123 BC", model: "Cobalt" })).statusCode).toBe(409);
    expect((await as(ctx.app, operator).post("/api/vehicles", { plateNumber: "ABC", model: "Cobalt" })).statusCode).toBe(400);
  });

  it("an assigned vehicle cannot be archived; archiving a driver frees it", async () => {
    const a = await create(operator);
    const v = (await as(ctx.app, operator).post("/api/vehicles", { plateNumber: "01A123BC", model: "Cobalt" })).json();
    await as(ctx.app, operator).put(`/api/drivers/${a.id}/vehicle`, { vehicleId: v.id });
    expect((await as(ctx.app, operator).post(`/api/vehicles/${v.id}/archive`)).statusCode).toBe(409);
    await as(ctx.app, operator).post(`/api/drivers/${a.id}/archive`, { reason: "Ketdi" });
    const list = (await as(ctx.app, operator).get("/api/vehicles?assigned=false")).json();
    expect(list.items.map((x: { id: string }) => x.id)).toContain(v.id);
    expect((await as(ctx.app, operator).post(`/api/vehicles/${v.id}/archive`)).statusCode).toBe(200);
  });

  it("managers cannot manage vehicles", async () => {
    expect((await as(ctx.app, manager).get("/api/vehicles")).statusCode).toBe(403);
    expect((await as(ctx.app, manager).post("/api/vehicles", { plateNumber: "01A123BC", model: "X" })).statusCode).toBe(403);
  });
});

describe("aggregators", () => {
  it("starts with an unconfirmed money flow", async () => {
    const res = await as(ctx.app, admin).post("/api/aggregators", { code: "MyTaxi", name: "MyTaxi" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ code: "mytaxi", moneyFlowModel: "unconfirmed", integrationStatus: "file_import" });
  });

  it("only the owner may confirm or change the money flow, and it is audited", async () => {
    const byAdmin = await as(ctx.app, admin).patch(`/api/aggregators/${aggregatorId}`, { moneyFlowModel: "park_collects" });
    expect(byAdmin.statusCode).toBe(403);
    const renameByAdmin = await as(ctx.app, admin).patch(`/api/aggregators/${aggregatorId}`, { name: "Yandex" });
    expect(renameByAdmin.statusCode).toBe(200);
    const byOwner = await as(ctx.app, owner).patch(`/api/aggregators/${aggregatorId}`, { moneyFlowModel: "park_collects" });
    expect(byOwner.statusCode).toBe(200);
    const [entry] = await ctx.db.select().from(auditLogs).where(eq(auditLogs.action, "aggregator.money_flow_change"));
    expect(entry).toBeDefined();
  });

  it("lists linked driver counts and is readable by driver roles", async () => {
    const d = await create(operator);
    await as(ctx.app, operator).post(`/api/drivers/${d.id}/accounts`, { aggregatorId, externalDriverId: "YX-1" });
    const res = await as(ctx.app, manager).get("/api/aggregators");
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0]).toMatchObject({ name: "Yandex Go", linkedDrivers: 1 });
    expect((await as(ctx.app, manager).post("/api/aggregators", { code: "x1", name: "X" })).statusCode).toBe(403);
  });
});

describe("CRM dashboard numbers", () => {
  it("match the database and respect the manager scope", async () => {
    const a = await create(operator, { managerId });
    const b = await create(operator, { phone: "+998901112255", registeredOn: "2020-01-01" });
    await create(operator, { phone: "+998901112266" });
    await as(ctx.app, operator).post(`/api/drivers/${a.id}/status`, { status: "active" });
    await as(ctx.app, operator).post(`/api/drivers/${b.id}/status`, { status: "terminated", reason: "Ketdi" });
    await as(ctx.app, operator).post(`/api/drivers/${a.id}/accounts`, { aggregatorId, externalDriverId: "YX-1" });

    const stats = (await as(ctx.app, owner).get("/api/dashboard/crm?period=this_month")).json();
    expect(stats).toMatchObject({
      totalDrivers: 3,
      activeDrivers: 1,
      newDrivers: 2,
      inactiveDrivers: 1,
      withoutManager: 2,
      withoutAggregatorAccount: 2,
    });
    const mine = (await as(ctx.app, manager).get("/api/dashboard/crm")).json();
    expect(mine.totalDrivers).toBe(1);
    const custom = (await as(ctx.app, owner).get("/api/dashboard/crm?period=custom&from=2020-01-01&to=2020-01-31")).json();
    expect(custom.newDrivers).toBe(1);
  });
});
