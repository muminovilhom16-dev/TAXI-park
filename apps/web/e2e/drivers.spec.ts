import { expect, test } from "@playwright/test";
import { login, uniquePhone, uniquePlate } from "./helpers";

test("owner registers a driver, links an aggregator ID, assigns a car, suspends and archives", async ({ page }) => {
  await login(page, "owner");
  const plate = uniquePlate();
  const phone = uniquePhone();

  // A free car to assign later.
  await page.goto("/vehicles");
  await page.getByRole("button", { name: "Avtomobil qo'shish" }).click();
  await page.fill("#plate", plate);
  await page.fill("#make", "Chevrolet");
  await page.fill("#model", "Cobalt");
  await page.getByRole("button", { name: "Saqlash" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Driver: required fields are validated before saving.
  await page.goto("/drivers");
  await page.getByRole("button", { name: "Haydovchi qo'shish" }).click();
  await page.getByRole("button", { name: "Saqlash" }).click();
  await expect(page.getByRole("dialog").locator("[aria-invalid=true]").first()).toBeVisible();
  await page.fill("#lastName", "Karimov");
  await page.fill("#firstName", "Jasur");
  await page.fill("#driverPhone", phone);
  await page.getByRole("button", { name: "Saqlash" }).click();
  await expect(page).toHaveURL(/\/drivers\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Karimov Jasur" })).toBeVisible();
  await expect(page.getByText("Agregatorga bog'lanmagan")).toBeVisible();

  // Aggregator account.
  const externalId = `E2E-${Date.now()}`;
  await page.getByRole("button", { name: "ID bog'lash" }).click();
  await page.selectOption("#aggregator", { label: "Demo agregator" });
  await page.fill("#externalId", externalId);
  await page.getByRole("dialog").locator("button[type=submit]").click();
  await expect(page.getByRole("cell", { name: externalId })).toBeVisible();

  // Car.
  await page.getByRole("button", { name: "Biriktirish" }).click();
  await page.locator("#vehicle").selectOption({ index: 1 });
  await page.getByRole("dialog").locator("button[type=submit]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bo'shatish" })).toBeVisible();

  // Suspending needs a reason.
  await page.getByRole("button", { name: "Holatni o'zgartirish" }).click();
  await page.selectOption("#newStatus", "suspended");
  const submit = page.getByRole("dialog").locator("button[type=submit]");
  await expect(submit).toBeDisabled();
  await page.fill("#reason", "Hujjatlar tekshirilmoqda");
  await submit.click();
  await expect(page.getByText("Hujjatlar tekshirilmoqda").first()).toBeVisible();

  // The list finds the driver by aggregator ID and by phone digits.
  await page.goto("/drivers");
  await page.getByLabel("Qidirish").fill(externalId);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("Karimov Jasur");
  await page.getByLabel("Qidirish").fill(phone.replace(/\D/g, "").slice(-7));
  await expect(page.locator("tbody tr")).toHaveCount(1);

  // A second driver with the same phone is flagged before saving.
  await page.getByRole("button", { name: "Haydovchi qo'shish" }).click();
  await page.fill("#lastName", "Boshqa");
  await page.fill("#firstName", "Odam");
  await page.fill("#driverPhone", phone);
  await page.locator("#firstName").focus();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Karimov Jasur");
  await page.getByRole("button", { name: "Bekor qilish" }).click();

  // Archiving frees the car and hides the driver from the default list.
  await page.locator("tbody").getByRole("link", { name: "Karimov Jasur" }).click();
  await page.getByRole("button", { name: "Arxivlash" }).click();
  await page.fill("#archiveReason", "Ishdan ketdi");
  await page.getByRole("dialog").locator("button[type=submit]").click();
  await expect(page.getByRole("button", { name: "Arxivdan chiqarish" })).toBeVisible();
  await expect(page.getByText("Biriktirilmagan").first()).toBeVisible();

  await page.goto("/drivers");
  await page.getByLabel("Qidirish").fill(externalId);
  await expect(page.getByText("Haydovchi topilmadi")).toBeVisible();
});

test("money flow cannot be changed by an admin", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/aggregators");
  await page.getByRole("button", { name: "Demo agregator: tahrirlash" }).click();
  await expect(page.locator("#aggFlow")).toBeDisabled();
});
