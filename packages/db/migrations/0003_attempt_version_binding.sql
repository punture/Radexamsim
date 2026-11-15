-- A case attempt stays bound to the exact case version, session and position it started
-- with. Owner revisions create new versions; they can never re-point an existing attempt
-- (spec §18: "Owner edits a published case -> active attempts stay bound to their version").
CREATE OR REPLACE FUNCTION case_attempt_binding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.case_version_id IS DISTINCT FROM OLD.case_version_id
     OR NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.ordinal IS DISTINCT FROM OLD.ordinal THEN
    RAISE EXCEPTION 'case attempt binding is immutable (case version, session and ordinal cannot change)';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER case_attempts_binding_immutable BEFORE UPDATE ON case_attempts FOR EACH ROW EXECUTE FUNCTION case_attempt_binding_immutable();
