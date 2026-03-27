-- Add unique constraint on events.external_id for upsert support
ALTER TABLE events ADD CONSTRAINT events_external_id_unique UNIQUE (external_id);
