import { expect, test } from "@playwright/test";
import { login, PASSWORD } from "./helpers";

test("wrong password is refused, right one signs in, logout returns to login", async ({ page }) => {
  await page.goto("/drivers");
  await expect(page).toHaveURL(/\/login/);
  await page.fill("#login", "owner");
  await page.fill("#password", "wrong-password");
  await page.click("button[type=submit]");
  await expect(page.getByRole("alert")).toBeVisible();

  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/drivers/);

  await page.getByRole("button", { name: "Chiqish" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("accountant cannot open vehicles or staff pages", async ({ page }) => {
  await login(page, "accountant");
  const nav = page.locator("nav");
  await expect(nav.getByRole("link", { name: "Haydovchilar" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Xodimlar" })).toHaveCount(0);
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Ruxsat yo'q" })).toBeVisible();
});
