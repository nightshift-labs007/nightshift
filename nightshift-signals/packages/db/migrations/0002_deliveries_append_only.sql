-- deliveries is an audit log: it proves when each basket reached each channel. Rows are never changed.
CREATE OR REPLACE FUNCTION deliveries_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'deliveries is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER deliveries_no_update_delete
  BEFORE UPDATE OR DELETE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION deliveries_append_only();
