-- Append-only audit tables: block UPDATE, DELETE and TRUNCATE at the database level,
-- so the trail holds even against application bugs or ad-hoc SQL by the app role.
CREATE OR REPLACE FUNCTION kato_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Kato audit table "%" is append-only (% blocked)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ConversationMessage', 'BRDDocument', 'ApprovalLog'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS kato_immutable_row ON %I', t);
    EXECUTE format('CREATE TRIGGER kato_immutable_row BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION kato_forbid_mutation()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS kato_immutable_truncate ON %I', t);
    EXECUTE format('CREATE TRIGGER kato_immutable_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION kato_forbid_mutation()', t);
  END LOOP;
END $$;
