-- Security policies (spec §16, §17).
-- 1) The browser never talks to Postgres directly. Every table has row-level security
--    enabled with NO permissive policies, so Supabase API roles (anon, authenticated) are
--    denied by default even if the PostgREST endpoint is exposed. The application connects
--    as the table owner, which RLS does not restrict; authorization is enforced in the API.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
  END IF;
END $$;
--> statement-breakpoint
-- 2) Session events are append-only (deletion is permitted for retention/erasure workflows).
CREATE OR REPLACE FUNCTION forbid_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (UPDATE not permitted)', TG_TABLE_NAME;
END $$;
--> statement-breakpoint
CREATE TRIGGER session_events_no_update BEFORE UPDATE ON session_events FOR EACH ROW EXECUTE FUNCTION forbid_update();
--> statement-breakpoint
-- 3) The usage ledger is immutable: corrections are new 'adjust' entries.
CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable (% not permitted)', TG_TABLE_NAME, TG_OP;
END $$;
--> statement-breakpoint
CREATE TRIGGER usage_ledger_immutable BEFORE UPDATE OR DELETE ON usage_ledger FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint
-- 4) Original transcript text and timing are immutable. Revisions are new rows that
--    supersede the original; only status/revision bookkeeping may change.
CREATE OR REPLACE FUNCTION transcript_original_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.text IS DISTINCT FROM OLD.text OR NEW.start_ms IS DISTINCT FROM OLD.start_ms
     OR NEW.end_ms IS DISTINCT FROM OLD.end_ms OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.words IS DISTINCT FROM OLD.words THEN
    RAISE EXCEPTION 'transcript segment content is immutable; insert a revision instead';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER transcript_segments_immutable BEFORE UPDATE ON transcript_segments FOR EACH ROW EXECUTE FUNCTION transcript_original_immutable();
--> statement-breakpoint
-- 5) Final assessments are never overwritten: new versions are inserted.
CREATE TRIGGER case_assessments_no_update BEFORE UPDATE ON case_assessments FOR EACH ROW EXECUTE FUNCTION forbid_update();
--> statement-breakpoint
-- 6) Wake workers promptly when jobs are queued.
CREATE OR REPLACE FUNCTION notify_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('jobs_queued', NEW.kind);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jobs_notify AFTER INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION notify_job();
