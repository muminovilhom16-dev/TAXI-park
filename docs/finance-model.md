# Moliyaviy model

Bu hujjat tizimdagi pul tushunchalari nimani anglatishini belgilaydi. Kod va hisobotlar shu ta'riflarga tayanadi. Yangi tranzaksiya turi qo'shilsa, avval shu hujjat yangilanadi.

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
