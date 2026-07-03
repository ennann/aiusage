-- Store local session activity metrics uploaded by CLI sync.

CREATE TABLE IF NOT EXISTS daily_activity_breakdown (
  device_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  provider TEXT NOT NULL,
  product TEXT NOT NULL,
  source TEXT NOT NULL,
  project TEXT NOT NULL DEFAULT 'unknown',
  project_display TEXT,
  project_alias TEXT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'exact',
  event_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, usage_date, provider, product, source, project, kind, name, confidence),
  FOREIGN KEY (device_id) REFERENCES devices(device_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_date ON daily_activity_breakdown(usage_date);
CREATE INDEX IF NOT EXISTS idx_activity_device_date ON daily_activity_breakdown(device_id, usage_date);
CREATE INDEX IF NOT EXISTS idx_activity_provider_product ON daily_activity_breakdown(provider, product, usage_date);
CREATE INDEX IF NOT EXISTS idx_activity_project_display ON daily_activity_breakdown(project_display, usage_date);
CREATE INDEX IF NOT EXISTS idx_activity_project_alias ON daily_activity_breakdown(project_alias, usage_date);
