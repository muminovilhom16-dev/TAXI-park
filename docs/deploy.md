# Serverga o'rnatish

Bu qo'llanma tizimni bitta VPS serverga o'rnatadi: PostgreSQL, API, veb-ilova (Caddy, avtomatik HTTPS) va kundalik zaxira nusxa. Hammasi `docker compose` bilan ishlaydi.

## 1. Kerak bo'ladigan narsalar

- **VPS server**: Ubuntu 22.04 yoki 24.04, kamida 2 GB RAM, 2 vCPU, 20 GB disk. Birinchi build uchun 2 GB RAM kerak; 1 GB li serverda build to'xtab qolishi mumkin.
- **Domen**, masalan `park.sizningdomen.uz`. HTTPS sertifikati faqat domen uchun beriladi, IP manzil uchun emas.
- Serverga SSH orqali kirish.

> Shaxsiy ma'lumotlar (haydovchilarning pasporti, telefoni) qayerda saqlanishi kerakligi haqida O'zbekiston qonunchiligida talab bo'lishi mumkin. Serverni qaysi davlatda ijaraga olishni yurist bilan tekshiring.

## 2. Domenni serverga ulash

Domen sotib olingan joyning DNS sozlamalarida **A yozuv** qo'shing:

| Turi | Nomi | Qiymati |
| --- | --- | --- |
| A | `park` (yoki `@`) | serverning IP manzili |

Tekshirish: `ping park.sizningdomen.uz` server IP sini ko'rsatishi kerak. DNS tarqalishi bir necha daqiqadan bir necha soatgacha davom etadi. Shu ishlamaguncha keyingi qadamlarda HTTPS sertifikati olinmaydi.

## 3. Serverni tayyorlash

```bash
ssh root@SERVER_IP

apt update && apt upgrade -y
# Docker va compose plagini
curl -fsSL https://get.docker.com | sh

# Faqat SSH, HTTP va HTTPS ochiq qoladi
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Postgres porti (5432) tashqariga ochilmaydi: `docker-compose.yml` uni faqat ichki tarmoqda ushlab turadi.

## 4. Kodni yuklash va sozlash

```bash
cd /opt
git clone https://github.com/muminovilhom16-dev/TAXI-park.git taxi
cd taxi
cp .env.example .env
openssl rand -base64 24   # chiqqan qatorni POSTGRES_PASSWORD ga qo'ying
nano .env
```

`.env` faylining pastki qismida shularni to'ldiring:

```ini
POSTGRES_PASSWORD=<openssl chiqargan parol>
SITE_ADDRESS=park.sizningdomen.uz
PUBLIC_ORIGIN=https://park.sizningdomen.uz
BACKUP_KEEP_DAYS=14
```

`.env` faylini hech kimga yubormang va Gitga qo'shmang. Ichidagi parol bazaning paroli.

```bash
chmod 600 .env
```

## 5. Ishga tushirish

```bash
docker compose up -d --build
docker compose ps
```

Birinchi build 3–10 daqiqa oladi. `docker compose ps` da `api` holati `healthy` bo'lishi kerak. API har startda bazaning migratsiyalarini o'zi qo'llaydi.

Brauzerda `https://park.sizningdomen.uz` ni oching. Agar sertifikat xatosi chiqsa, `docker compose logs web` ni ko'ring: odatda DNS hali tarqalmagan yoki 80/443 portlar yopiq bo'ladi.

## 6. Egasi hisobini yaratish

```bash
docker compose exec api node dist/create-owner.js --login egasi --name "Ism Familiya"
```

Buyruq parolni so'raydi (kamida 10 belgi). Bu faqat birinchi egasi uchun. Qolgan xodimlarni tizimga kirib, **Xodimlar** bo'limida qo'shing.

## 7. Birinchi sozlamalar

Egasi sifatida kiring va quyidagilarni kiriting. Ularsiz pul hisoblanmaydi:

1. **Agregatorlar**: ishlaydigan taksi xizmatlarini qo'shing.
2. **Moliya sozlamalari → Komissiya stavkasi**: har bir agregator uchun `10%`, boshlanish sanasi bilan.
3. **Moliya sozlamalari → Kunlik obuna**: `40 000` so'm, tartib: *faqat ishlagan kunlari*.

## 8. Zaxira nusxa (backup)

`backup` konteyneri har kuni soat **03:00 (Toshkent vaqti)** bazaning to'liq nusxasini `/opt/taxi/backups/` ga yozadi va 14 kundan eskilarini o'chiradi.

Hozir qo'lda nusxa olish:

```bash
docker compose exec backup /usr/local/bin/backup.sh now
ls -lh backups/
```

**Muhim:** nusxa shu serverning o'zida turadi. Server yoki disk ishdan chiqsa, nusxalar ham yo'qoladi. Ularni muntazam boshqa joyga ko'chiring, masalan o'z kompyuteringizga:

```bash
# o'z kompyuteringizda
scp root@SERVER_IP:/opt/taxi/backups/taxi_*.dump ./taxi-backups/
```

Ko'pchilik VPS provayderlari pullik "snapshot" yoki "backup" xizmatini ham beradi; uni ham yoqib qo'yish tavsiya etiladi.

Nusxada haydovchilarning shaxsiy ma'lumotlari bor. Uni ochiq joyga (Telegram guruh, ochiq bulut papka) qo'ymang.

## 9. Nusxadan tiklash

```bash
cd /opt/taxi
./deploy/restore.sh backups/taxi_2026-10-24_220000.dump
```

Skript tasdiq so'raydi (`ha` deb yozing), keyin:

1. hozirgi holatning yangi zaxirasini oladi (xato tiklansa, unga qaytish mumkin);
2. API ni to'xtatadi;
3. bazani tanlangan nusxa bilan almashtiradi;
4. API ni qayta ishga tushiradi.

Tanlangan nusxadan keyin kiritilgan barcha ma'lumotlar yo'qoladi. Tiklashni oyiga bir marta sinab ko'rish tavsiya etiladi: tekshirilmagan zaxira zaxira emas.

## 10. Yangilash

```bash
cd /opt/taxi
docker compose exec backup /usr/local/bin/backup.sh now   # avval zaxira
git pull
docker compose up -d --build
docker compose ps
```

## Muammolar

| Belgi | Sabab va yechim |
| --- | --- |
| Sayt ochilmaydi | `docker compose ps` va `docker compose logs web api`. Portlar: `ufw status`. |
| Sertifikat xatosi | DNS A yozuvi server IP siga ko'rsatmayapti yoki 80-port yopiq. |
| Kirgandan keyin darhol chiqarib yuboradi | Sayt `http://` orqali ochilgan. Cookie faqat HTTPS da ishlaydi. |
| "Origin" xatosi bilan saqlanmaydi | `.env` dagi `PUBLIC_ORIGIN` brauzerdagi manzil bilan bir xil emas. |
| `api` holati `unhealthy` | `docker compose logs api`; ko'pincha `POSTGRES_PASSWORD` baza yaratilgandan keyin o'zgartirilgan. |
