CREATE TABLE IF NOT EXISTS scheduled_items (
  item_type TEXT NOT NULL,
  item_key TEXT NOT NULL,
  due_at INTEGER,
  lookup_key TEXT,
  reference_key TEXT,
  payload TEXT,
  PRIMARY KEY (item_type, item_key)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS scheduled_items_due_idx
  ON scheduled_items (item_type, due_at);

CREATE INDEX IF NOT EXISTS scheduled_items_lookup_idx
  ON scheduled_items (item_type, lookup_key, item_key);
