import { expect, test } from "@playwright/test";
import { login, uniquePhone } from "./helpers";

test("manager on a phone: own drivers only, no staff pages, no sideways scroll", async ({ page }) => {
  await login(page, "manager");
  await page.getByRole("button", { name: "Menyuni ochish" }).click();
  const nav = page.locator("nav").last();
  await expect(nav.getByRole("link", { name: "Haydovchilar" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Avtomobillar" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Xodimlar" })).toHaveCount(0);
  await nav.getByRole("link", { name: "Haydovchilar" }).click();

  await page.getByRole("button", { name: "Haydovchi qo'shish" }).click();
  // A manager cannot hand a driver to someone else, nor see passport fields.
  await expect(page.locator("#managerId")).toHaveCount(0);
  await expect(page.locator("#passport")).toHaveCount(0);
  await page.fill("#lastName", "Mobil");
  await page.fill("#firstName", "Test");
  await page.fill("#driverPhone", uniquePhone());
  await page.getByRole("button", { name: "Saqlash" }).click();
  await expect(page.getByRole("heading", { name: "Mobil Test" })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "Demo Menejer" })).toBeVisible();

  for (const path of ["/", "/drivers", page.url()]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal scroll on ${path}`).toBeLessThanOrEqual(0);
  }
});
