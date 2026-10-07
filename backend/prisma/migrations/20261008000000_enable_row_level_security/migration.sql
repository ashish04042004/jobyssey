-- Supabase exposes the `public` schema through its Data API to anyone holding
-- the project's anon key. The API reaches Postgres as the table owner, which
-- bypasses RLS, so enabling it with no policies closes the Data API and changes
-- nothing for the app. New tables need the same statement in their migration.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
