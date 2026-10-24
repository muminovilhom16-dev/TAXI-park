// Permission codes are the unit of authorization. Roles are just named bundles of
// these codes, so a role can be adjusted without touching endpoint code.
export const PERMISSIONS = {
  "users.manage": "Xodimlarni va ularning rollarini boshqarish",
  "roles.read": "Rollar va ruxsatlarni ko'rish",
  "audit.read": "Audit tarixini ko'rish",
  "settings.manage": "Tizim sozlamalarini o'zgartirish",
  "drivers.read_all": "Barcha haydovchilarni ko'rish",
  "drivers.read_assigned": "Faqat o'ziga biriktirilgan haydovchilarni ko'rish",
  "drivers.write": "Haydovchi ma'lumotlarini kiritish va tahrirlash",
  "drivers.pii.read": "Pasport va boshqa shaxsiy ma'lumotlarni ko'rish",
  "aggregators.manage": "Agregatorlar va ularning sozlamalarini boshqarish",
  "finance.read": "Moliyaviy ma'lumotlar va hisobotlarni ko'rish",
  "commission.manage": "Komissiya siyosatlarini yaratish",
  "imports.run": "Agregator hisobotlarini import qilish",
  "settlements.prepare": "Hisob-kitoblarni tayyorlash",
  "settlements.approve": "Hisob-kitoblarni tasdiqlash",
  "payments.write": "To'lovlar va tranzaksiyalarni kiritish",
  "payments.approve": "Tranzaksiyalarni tasdiqlash",
  "reports.export": "Hisobotlarni eksport qilish",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_CODES = ["owner", "admin", "manager", "accountant", "operator"] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const ROLE_NAMES: Record<RoleCode, string> = {
  owner: "Egasi",
  admin: "Administrator",
  manager: "Menejer",
  accountant: "Buxgalter",
  operator: "Operator",
};

// Default permission bundles. They are written to the database by the bootstrap
// step; approval rights are deliberately separate from preparation rights.
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  owner: ALL_PERMISSIONS,
  admin: [
    "roles.read",
    "drivers.read_all",
    "drivers.write",
    "drivers.pii.read",
    "aggregators.manage",
  ],
  manager: ["drivers.read_assigned", "drivers.write"],
  accountant: [
    "drivers.read_all",
    "finance.read",
    "imports.run",
    "settlements.prepare",
    "payments.write",
    "reports.export",
  ],
  operator: ["drivers.read_all", "drivers.write"],
};
