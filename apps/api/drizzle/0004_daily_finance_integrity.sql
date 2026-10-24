-- Daily earnings and driver charges are financial history: never deleted, and
-- the only change allowed is voiding an active row (with who, when and why).
CREATE FUNCTION guard_voidable_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['status', 'voided_by', 'voided_at', 'void_reason'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows cannot be deleted; void them instead', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION '% row % is frozen; void it and enter a new one', TG_TABLE_NAME, OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'voided' THEN
    RAISE EXCEPTION '% row % is already voided', TG_TABLE_NAME, OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER daily_earnings_guard BEFORE UPDATE OR DELETE ON "daily_earnings"
  FOR EACH ROW EXECUTE FUNCTION guard_voidable_entry();
--> statement-breakpoint
CREATE TRIGGER driver_charges_guard BEFORE UPDATE OR DELETE ON "driver_charges"
  FOR EACH ROW EXECUTE FUNCTION guard_voidable_entry();
