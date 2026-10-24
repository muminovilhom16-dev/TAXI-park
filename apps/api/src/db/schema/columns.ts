import { numeric, timestamp, uuid } from "drizzle-orm/pg-core";

export const id = () => uuid("id").primaryKey().defaultRandom();

export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Money is NUMERIC(18,2) everywhere and travels as a string, never a JS number. */
export const money = (name: string) => numeric(name, { precision: 18, scale: 2 });

/** Percent with four decimals, e.g. 10.0000. */
export const percent = (name: string) => numeric(name, { precision: 7, scale: 4 });
