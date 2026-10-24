import { expect, test, type Page } from "@playwright/test";
import { login, uniquePhone } from "./helpers";

// Tashkent calendar days, as the app counts them.
const day = (offset: number) => new Date(Date.now() + 5 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);

async function logout(page: Page) {
  await page.getByRole("button", { name: "Chiqish" }).click();
  await expect(page).toHaveURL(/\/login/);
}

test("rate, takings, subscription debt, payment and its approval", async ({ page }) => {
  const externalId = `FIN-${Date.now()}`;
  const lastName = `Moliya${Date.now() % 100000}`;

  // Owner: rate, subscription rule and a driver with an aggregator ID.
  await login(page, "owner");
  await page.goto("/finance-settings");
  await page.getByRole("button", { name: "Yangi stavka" }).click();
  await page.selectOption("#rateAgg", { label: "Demo agregator" });
  await page.fill("#rate", "10");
  await page.fill("#rateFrom", day(-30));
  await page.getByRole("dialog").locator("button[type=submit]").click();
  await expect(page.getByRole("cell", { name: "10%" })).toBeVisible();

  await page.fill("#subAmount", "50 000");
  await page.selectOption("#subMode", "worked_days_only");
  await page.getByRole("button", { name: "Saqlash" }).click();
  await expect(page.getByText("Sozlamalar saqlandi")).toBeVisible();

  await page.goto("/drivers");
  await page.getByRole("button", { name: "Haydovchi qo'shish" }).click();
  await page.fill("#lastName", lastName);
  await page.fill("#firstName", "Aziz");
  await page.fill("#driverPhone", uniquePhone());
  // Subscription is only charged from the registration day on.
  await page.fill("#registeredOn", day(-30));
  await page.getByRole("button", { name: "Saqlash" }).click();
  await page.getByRole("button", { name: "ID bog'lash" }).click();
  await page.selectOption("#aggregator", { label: "Demo agregator" });
  await page.fill("#externalId", externalId);
  await page.getByRole("dialog").locator("button[type=submit]").click();
  await expect(page.getByRole("cell", { name: externalId })).toBeVisible();
  await logout(page);

  // Accountant: yesterday's takings by hand, the day before by CSV.
  await login(page, "accountant");
  await page.goto("/earnings");
  await page.getByRole("button", { name: "Tushum kiritish" }).click();
  await page.fill("#earnDriver", lastName);
  await page.getByRole("option", { name: new RegExp(lastName) }).click();
  await page.selectOption("#earnAgg", { label: "Demo agregator" });
  await page.fill("#earnDate", day(-1));
  await page.fill("#earnAmount", "350 000");
  await page.getByRole("dialog").locator("button[type=submit]").click();
  await expect(page.getByText(/Komissiya: 35\s000 so'm/)).toBeVisible();
  await page.getByRole("dialog").getByText("Yopish", { exact: true }).click();

  await page.getByRole("button", { name: "CSV yuklash" }).click();
  await page.selectOption("#impAgg", { label: "Demo agregator" });
  await page.setInputFiles("#impFile", {
    name: "tushum.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`sana;agregator_id;summa\n${day(-2)};${externalId};200 000\n${day(-2)};NOMALUM-1;100 000\n`),
  });
  await page.getByRole("button", { name: "Tekshirish" }).click();
  await expect(page.getByText("Kiritiladi: 1")).toBeVisible();
  await expect(page.getByText("Haydovchi topilmadi: 1")).toBeVisible();
  await page.getByRole("button", { name: "1 ta qatorni kiritish" }).click();
  await expect(page.getByText("1 ta qator kiritildi")).toBeVisible();

  await page.fill("#from", day(-2));
  await page.fill("#to", day(-1));
  await expect(page.locator("tbody tr").filter({ hasText: lastName })).toHaveCount(2);

  // Two worked days → two subscriptions; the debt shows on the debt list.
  await page.goto("/debts");
  const row = page.locator("tbody tr").filter({ hasText: lastName });
  await expect(row).toContainText(/100\s000 so'm/);
  await row.getByRole("button", { name: "To'lov" }).click();
  await page.fill("#payAmount", "100 000");
  await page.getByRole("dialog").locator("button[type=submit]").click();
  await expect(page.getByText(/U tasdiqlangach qarzdan ayriladi/)).toBeVisible();
  // Not counted until approved.
  await expect(row).toContainText(/100\s000 so'm/);
  await logout(page);

  // Owner approves; the driver leaves the debtor list.
  await login(page, "owner");
  await page.goto("/payments");
  const pending = page.locator("tbody tr").filter({ hasText: lastName });
  await pending.getByRole("button", { name: "Tasdiqlash" }).click();
  await expect(page.getByText("To'lov tasdiqlandi")).toBeVisible();
  await page.goto("/debts");
  await expect(page.locator("tbody tr").filter({ hasText: lastName })).toHaveCount(0);

  // The profile shows the balance and the history.
  await page.goto("/drivers");
  await page.getByLabel("Qidirish").fill(externalId);
  await page.locator("tbody").getByRole("link", { name: new RegExp(lastName) }).click();
  await expect(page.getByRole("heading", { name: "Moliya", exact: true })).toBeVisible();
  await expect(page.getByText("Qoldiq (qarz)").locator("..")).toContainText("0 so'm");

  await page.goto("/");
  await expect(page.getByText("Park komissiyasi")).toBeVisible();
});

test("an operator sees no money pages", async ({ page }) => {
  await login(page, "operator");
  await expect(page.locator("nav").getByRole("link", { name: "Qarzlar" })).toHaveCount(0);
  await page.goto("/debts");
  await expect(page.getByRole("heading", { name: "Ruxsat yo'q" })).toBeVisible();
});
