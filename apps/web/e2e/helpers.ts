import { expect, type Page } from "@playwright/test";

// Seeded by `seed-dev` in the e2e database.
export const PASSWORD = "demo-parol-123";

export async function login(page: Page, user: string) {
  await page.goto("/login");
  await page.fill("#login", user);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await expect(page).not.toHaveURL(/\/login/);
}

// Unique per run, so specs never collide with rows left by earlier tests.
let n = Date.now() % 100_000;
export function uniquePhone() {
  n += 1;
  return `+998 90 ${String(n).padStart(7, "0").replace(/(\d{3})(\d{2})(\d{2})/, "$1 $2 $3")}`;
}
export function uniquePlate() {
  n += 1;
  return `01 A ${String(n % 1000).padStart(3, "0")} ${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + ((n >> 5) % 26))}`;
}
