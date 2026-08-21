CREATE TABLE IF NOT EXISTS readings (
  timestamp_utc TEXT PRIMARY KEY,
  occupancy INTEGER NOT NULL CHECK (occupancy >= 0),
  status TEXT NOT NULL CHECK (length(status) > 0)
);
CREATE INDEX IF NOT EXISTS readings_timestamp_idx ON readings (timestamp_utc);
CREATE TABLE IF NOT EXISTS collector_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

