# Moliyaviy model

Bu hujjat tizimdagi pul tushunchalari nimani anglatishini belgilaydi. Kod va hisobotlar shu ta'riflarga tayanadi. Yangi tranzaksiya turi qo'shilsa, avval shu hujjat yangilanadi.

## Hozir ishlayotgan kunlik model (2026-10-24)

Park egasi bergan qoidalar:

- Park daromadi: haydovchining kunlik tushumidan 10% komissiya. Stavka sozlamada, agregator bo'yicha va sanadan boshlab belgilanadi.
- Hisob-kitob kunlik.
- Haydovchiga kunlik obuna yoziladi. Faqat obuna qarzga aylanishi mumkin.
- Komissiyani agregator o'zi ushlab qoladi, shuning uchun u qarzga aylanmaydi. Bu tasdiqlanmagan: agregator shartnomasida tekshirilishi kerak. Shuning uchun `commission.collection` sozlamasi bor (`withheld` yoki `driver_pays`).

| Obyekt | Jadval | Ma'nosi |
| --- | --- | --- |
| Kunlik tushum | `daily_earnings` | Bir haydovchining bir agregatordagi bir kunlik tushumi. Komissiya kiritilgan paytda hisoblanadi va stavka bilan birga muzlatiladi. |
| Hisoblangan summa | `driver_charges` | Haydovchi parkka qarzdor bo'lgan summa: kunlik obuna (`subscription`), komissiya (faqat `driver_pays` rejimida) yoki boshqa (`other`). |
| To'lov | `financial_transactions` (`driver_other_payment_in`) | Haydovchi to'lagan pul. Boshqa xodim tasdiqlagandan keyingina hisobga olinadi. |

**Qarz (qoldiq)** = faol hisoblangan summalar − tasdiqlangan to'lovlar. Bekor qilingan to'lov `adjustment` (`out`) sifatida qarzga qaytadi. Qoldiq hech qayerda saqlanmaydi, har safar hisoblanadi. Manfiy qoldiq oldindan to'lov (haqdorlik) degani.

**Komissiya** = `tushum × stavka / 100`, butun so'mgacha half-up yaxlitlanadi (`money.rounding`). Hisob BigInt'da, tiyinlarda bajariladi, float ishlatilmaydi.

**Obuna** (`subscription.daily_amount`, `subscription.charge_mode`). Egasi summa va tartibni kiritmaguncha o'chiq turadi.
- `every_active_day`: CRM holati "Faol" bo'lgan, arxivda bo'lmagan, ro'yxatdan o'tgan kuni shu kundan oldin yoki shu kun bo'lgan har bir haydovchiga yoziladi. Server buni har soatda bugungi kun uchun avtomatik bajaradi. O'tgan kunlar uchun buxgalter qo'lda hisoblaydi. Holat sana bo'yicha emas, hozirgi holatdan olinadi.
- `worked_days_only`: o'sha kun uchun tushum kiritilganda yoziladi. Tushum bekor qilinsa va shu kunda boshqa tushum qolmasa, obuna ham bekor qilinadi.
- Bir haydovchiga bir kunda faqat bitta faol obuna yoziladi (unique index). Shuning uchun qayta ishga tushirish yoki parallel ishga tushirish xavfsiz.

**Tuzatish.** Tushum va hisoblangan summalar o'chirilmaydi va o'zgartirilmaydi (trigger). Xato bo'lsa, egasi sabab yozib bekor qiladi va to'g'risi qaytadan kiritiladi.

Quyidagi bo'limlardagi settlement va import jadvallari agregator hisobotlari uchun tayyorlangan. Real hisobot fayli kelguncha ular ishlatilmaydi.

## Uchta asosiy obyekt

| Obyekt | Jadval | Nimani ifodalaydi |
| --- | --- | --- |
| Settlement | `settlements` | Majburiyat: bir davr uchun haydovchi va park o'rtasida kim kimga qancha qarzdor. Pul harakati emas. |
| Tranzaksiya | `financial_transactions` | Haqiqatda bo'lgan pul harakati: kassa yoki hisobdan pul kirdi yoki chiqdi. Balans saqlamaydi. |
| Taqsimlash | `payment_allocations` | Qaysi to'lov qaysi settlementni yopgani. Bitta to'lov bir nechta settlementga bo'linishi mumkin. |

Qoldiq (masalan, haydovchiga hali to'lanmagan summa) hech qayerda qo'lda saqlanmaydi. U har doim serverda hisoblanadi: `settlement summasi − shu settlementga taqsimlangan to'lovlar`.

## Tranzaksiya turlari

| Tur | Yo'nalish | Ma'nosi | Park daromadimi? |
| --- | --- | --- | --- |
| `aggregator_payout_in` | kirim | Agregator parkka pul o'tkazdi (`park_collects`). Bu pulning katta qismi haydovchilarniki. | Yo'q. Bu haydovchilar puli tranzit sifatida |
| `driver_payout_out` | chiqim | Park haydovchiga uning ulushini to'ladi | Yo'q |
| `commission_in` | kirim | Haydovchi parkka komissiyani to'ladi (`driver_collects`) | Ha, haqiqiy tushum |
| `park_expense` | chiqim | Parkning operatsion xarajati | Xarajat |
| `driver_other_payment_in` | kirim | Haydovchidan boshqa to'lov (jarima, ijara va hokazo) | Shartnomaga bog'liq. Kategoriya bilan belgilanadi |
| `refund` | ikkalasi | Qaytarim | Asl tranzaksiyaga qarab |
| `adjustment` | ikkalasi | Tuzatish yoki reversal (`reverses_transaction_id` bilan) | Asl tranzaksiyaga qarab |

`park_collects` modelida park komissiyasi alohida pul bo'lib kelmaydi. U `aggregator_payout_in` ichida turadi va haydovchiga kamroq to'lash orqali ushlab qolinadi. Shuning uchun bitta pulni ikki marta daromad deb hisoblamaslik kerak: `aggregator_payout_in` daromad emas, park daromadi faqat tasdiqlangan settlementdagi komissiya.

## Hozircha noma'lum va konfiguratsiya qilinadigan narsalar

- **Pul oqimi modeli** (`aggregators.money_flow_model`) default `unconfirmed`. Bu holatda settlement avtomatik tasdiqlanmaydi.
- **Komissiya bazasi** (`commission_policies.base_type` va `base_rules`). Bonus, jarima, qaytarim va naqd to'lovlar bazaga avtomatik qo'shilmaydi.
- **Rounding**: `money.rounding` sozlamasi, default butun so'mgacha, half-up.
- **Hisobot ustunlari**: `aggregator_statement_lines` jadvalidagi summa ustunlari real hisobot ko'rilgunga qadar vaqtinchalik. Asl qator har doim `raw` maydonida saqlanadi.

## Database darajasidagi kafolatlar

`drizzle/0001_integrity.sql` migratsiyasi quyidagilarni ta'minlaydi. Ilova kodida xato bo'lsa ham ular ishlaydi:

- Tasdiqlangan settlementning summalari, stavkasi va formulasi o'zgarmaydi, uni o'chirib ham bo'lmaydi. Xato bo'lsa, reversal yaratiladi.
- Tranzaksiyalar o'chirilmaydi. Tasdiqlangandan keyin o'zgartirilmaydi.
- Bitta to'lovga taqsimlangan summalar yig'indisi to'lov summasidan oshmaydi, parallel so'rovlarda ham (qator qulfi bilan).
- Bir xil fayl va bir xil hisobot qatori ikki marta import qilinmaydi.
- Tasdiqlangan komissiya siyosati o'zgarmaydi. Uni faqat yopish mumkin (`valid_to`), yangi stavka yangi siyosat sifatida kiritiladi.
- Audit log, status tarixi va taqsimlashlar faqat qo'shiladi.
