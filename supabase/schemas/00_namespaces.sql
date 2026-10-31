-- Current desired schema: 00_namespaces.sql
-- Derived from the isolated PostgreSQL 17 catalogue; no historical upgrade replay.

-- Fresh installs only. Refuse to replace an existing workspace or its records.
DO $installation$ BEGIN
 IF to_regclass('public.opportunities') IS NOT NULL OR to_regclass('public.applications') IS NOT NULL THEN
  RAISE EXCEPTION 'The current workspace already exists. Review a targeted schema diff instead of replaying the fresh installer.';
 END IF;
END $installation$;

-- -.private
CREATE SCHEMA private;

-- -.public
CREATE SCHEMA IF NOT EXISTS public;
