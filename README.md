# Taxi Park Management System

O'zbekistondagi taksi parklari uchun boshqaruv tizimi: haydovchilar, agregator hisobotlari, park komissiyasi, to'lovlar va qarzdorlik.

## Hozirgi holat

| Modul | Holat |
| --- | --- |
| Database schema, migratsiyalar, moliyaviy yaxlitlik triggerlari | Tayyor |
| Login, sessiyalar, rollar va ruxsatlar (server tomonida) | Tayyor |
| Xodimlarni boshqarish | Tayyor |
| Audit log | Tayyor |
| Haydovchilar CRM, avtomobillar, agregatorlar, CRM ko'rsatkichlari | Tayyor |
| Kunlik tushum (qo'lda va CSV), komissiya, kunlik obuna, qarz, to'lovlar | Tayyor |
| Real agregator hisobotini to'g'ridan-to'g'ri import qilish | Hisobot namunasi kerak |
| Dashboard, hisobotlar, eksport, bildirishnomalar | 4-qadam |

Moliyaviy tushunchalar va qoidalar: [docs/finance-model.md](docs/finance-model.md).

## Stack

- `apps/web`: React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, React Router
- `apps/api`: Node.js 22, Fastify 5, Drizzle ORM, PostgreSQL 16, Zod, argon2id
- `packages/shared`: ruxsatlar, API sxemalari va formatlash (frontend va backend uchun umumiy)

## Lokal ishga tushirish

Talablar: Node.js 22, pnpm 10, PostgreSQL 16.

```bash
cp .env.example .env            # DATABASE_URL ni tekshiring
createdb taxi_dev && createdb taxi_test
pnpm install
pnpm db:migrate                 # migratsiyalar + rollar va sozlamalar
pnpm db:seed                    # faqat development: demo xodimlar
pnpm dev                        # API :3000, web :5173
```

Demo loginlar (`db:seed` dan keyin): `owner`, `admin`, `manager`, `accountant`, `operator`. Paroli `demo-parol-123`.

Haqiqiy muhitda birinchi egasini yaratish:

```bash
pnpm create-owner --login egasi --name "Ism Familiya"   # parolni so'raydi
```

## Testlar

```bash
pnpm test        # TEST_DATABASE_URL dagi bazani o'chirib, migratsiyalardan qayta quradi
pnpm typecheck
pnpm test:e2e    # brauzer testlari (Playwright, kompyuter va telefon ekrani)
```

API testlari mock emas, haqiqiy PostgreSQL bilan ishlaydi. Ular ruxsatlar matritsasini (5 rol × endpointlar, shu jumladan qabul testi 7), sessiya xavfsizligini (CSRF, Origin, rate limit, sessiyani bekor qilish) va database darajasidagi moliyaviy kafolatlarni (o'zgarmas settlementlar, parallel to'lov taqsimlash, takroriy import) tekshiradi.

Brauzer testlari `E2E_DATABASE_URL` (standart: `taxi_e2e`) bazasini har safar o'chirib qayta yaratadi, shuning uchun baza nomida `e2e` bo'lishi shart. Postgres foydalanuvchisiga `CREATEDB` huquqi kerak. Chromium birinchi marta: `pnpm --filter @taxi/web exec playwright install chromium`.

## Database migratsiyalari

Schema `apps/api/src/db/schema/` da. O'zgartirgandan keyin:

```bash
pnpm db:generate     # drizzle/ ga yangi SQL migratsiya yozadi
pnpm db:migrate
```

Drizzle ifodalay olmaydigan qoidalar (triggerlar, EXCLUDE constraintlar) `drizzle/0001_integrity.sql` kabi qo'lda yozilgan migratsiyalarda turadi.

## Production (Docker Compose)

```bash
cp .env.example .env      # POSTGRES_PASSWORD va PUBLIC_ORIGIN ni o'rnating
docker compose up -d --build
docker compose exec api node dist/create-owner.js --login egasi --name "Ism Familiya"
```

API konteyneri har startda migratsiyalarni qo'llaydi. Web (Caddy) `/api` ni API ga proksi qiladi, shuning uchun cookie bir xil domenda qoladi. HTTPS uchun `deploy/Caddyfile` dagi `:80` ni domen nomiga almashtiring.

Backup va tiklash skriptlari 4-qadamda qo'shiladi. Ungacha production ma'lumotlarini `pg_dump` bilan qo'lda zaxiralang.

## Xavfsizlik

- Parollar argon2id bilan saqlanadi. Sessiya tokeni bazada faqat sha256 ko'rinishida turadi.
- Cookie: `httpOnly`, `SameSite=Strict`, productionda `__Host-` prefiksi va `Secure`.
- Har bir yozish so'rovi CSRF token va Origin tekshiruvidan o'tadi.
- Ruxsatlar har bir endpointda serverda tekshiriladi. Rad etilgan urinishlar audit logga yoziladi.
- Xodim o'chirilsa, roli o'zgarsa yoki paroli tiklansa, uning sessiyalari darhol bekor qilinadi.
- Audit logga parol, token va sessiya ma'lumotlari yozilmaydi.
