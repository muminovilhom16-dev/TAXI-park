-- Integrity rules that drizzle cannot express. These are the last line of
-- defence for financial history; application code must not rely on them alone.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

ALTER TABLE "settlements" ADD CONSTRAINT "settlements_reverses_fk"
  FOREIGN KEY ("reverses_settlement_id") REFERENCES "settlements"("id");
--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "transactions_reverses_fk"
  FOREIGN KEY ("reverses_transaction_id") REFERENCES "financial_transactions"("id");
--> statement-breakpoint

-- Direction must match the meaning of the type. refund and adjustment can go either way.
ALTER TABLE "financial_transactions" ADD CONSTRAINT "transaction_type_direction" CHECK (
  ("type" IN ('aggregator_payout_in', 'commission_in', 'driver_other_payment_in') AND "direction" = 'in')
  OR ("type" IN ('driver_payout_out', 'park_expense') AND "direction" = 'out')
  OR ("type" IN ('refund', 'adjustment'))
);
--> statement-breakpoint

-- A vehicle, and a driver, can hold only one open assignment at a time.
ALTER TABLE "driver_vehicle_assignments" ADD CONSTRAINT "dva_vehicle_no_overlap"
  EXCLUDE USING gist ("vehicle_id" WITH =, tstzrange("assigned_from", "assigned_to", '[)') WITH &&);
--> statement-breakpoint
ALTER TABLE "driver_vehicle_assignments" ADD CONSTRAINT "dva_driver_no_overlap"
  EXCLUDE USING gist ("driver_id" WITH =, tstzrange("assigned_from", "assigned_to", '[)') WITH &&);
--> statement-breakpoint

-- One commission policy per aggregator per day.
ALTER TABLE "commission_policies" ADD CONSTRAINT "commission_policies_no_overlap"
  EXCLUDE USING gist ("aggregator_id" WITH =, daterange("valid_from", "valid_to", '[)') WITH &&);
--> statement-breakpoint

CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: the table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER driver_status_history_append_only BEFORE UPDATE OR DELETE ON "driver_status_history"
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER payment_allocations_append_only BEFORE UPDATE OR DELETE ON "payment_allocations"
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint

-- Approved settlements: only the status (and its timestamps) may move; the
-- amounts, rate and formula are frozen. Nothing past review may be deleted.
CREATE FUNCTION guard_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['status', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status NOT IN ('draft', 'needs_review') THEN
      RAISE EXCEPTION 'settlement % is %, it cannot be deleted; create a reversal', OLD.id, OLD.status
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('approved', 'partially_paid', 'paid', 'reversed')
     AND (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'settlement % is %, its figures are frozen; create a reversal', OLD.id, OLD.status
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status IN ('approved', 'partially_paid', 'paid') AND NEW.status IN ('draft', 'needs_review') THEN
    RAISE EXCEPTION 'settlement % is %, it cannot go back to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'reversed' AND NEW.status <> 'reversed' THEN
    RAISE EXCEPTION 'a reversed settlement cannot be reopened' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER settlements_guard BEFORE UPDATE OR DELETE ON "settlements"
  FOR EACH ROW EXECUTE FUNCTION guard_settlement();
--> statement-breakpoint

-- Transactions are never deleted. Once approved or rejected they are frozen;
-- corrections are new rows that point at the original.
CREATE FUNCTION guard_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'financial transactions cannot be deleted; create a reversal' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.approval_status <> 'pending'
     AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'transaction % is %, it is frozen', OLD.id, OLD.approval_status USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER financial_transactions_guard BEFORE UPDATE OR DELETE ON "financial_transactions"
  FOR EACH ROW EXECUTE FUNCTION guard_transaction();
--> statement-breakpoint

-- Allocated total can never exceed the payment. The row lock serialises
-- concurrent allocations against the same transaction.
CREATE FUNCTION check_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tx_amount numeric(18,2);
  tx_status approval_status;
  allocated numeric(18,2);
BEGIN
  SELECT amount, approval_status INTO tx_amount, tx_status
    FROM financial_transactions WHERE id = NEW.transaction_id FOR UPDATE;
  IF tx_status = 'rejected' THEN
    RAISE EXCEPTION 'cannot allocate a rejected transaction' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(sum(amount), 0) INTO allocated
    FROM payment_allocations WHERE transaction_id = NEW.transaction_id;
  IF allocated + NEW.amount > tx_amount THEN
    RAISE EXCEPTION 'allocation exceeds transaction: % + % > %', allocated, NEW.amount, tx_amount
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_allocations_cap BEFORE INSERT ON "payment_allocations"
  FOR EACH ROW EXECUTE FUNCTION check_allocation();
--> statement-breakpoint

-- Approved commission policies are frozen except for closing them (valid_to).
CREATE FUNCTION guard_commission_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['valid_to', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'approved commission policy cannot be deleted' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.approved_at IS NOT NULL
     AND (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'approved commission policy % is frozen', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER commission_policies_guard BEFORE UPDATE OR DELETE ON "commission_policies"
  FOR EACH ROW EXECUTE FUNCTION guard_commission_policy();
