-- AIUsage D1 Schema v1

CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  hostname TEXT,
  public_label TEXT,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  token_version INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  app_version TEXT
);

CREATE TABLE IF NOT EXISTS daily_usage (
  device_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  cost_status TEXT NOT NULL DEFAULT 'exact',
  pricing_version TEXT,
  top_project_by_cost TEXT,
  top_project_cost_usd REAL,
  top_model_by_cost TEXT,
  top_model_cost_usd REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, usage_date),
  FOREIGN KEY (device_id) REFERENCES devices(device_id)
);

CREATE TABLE IF NOT EXISTS daily_usage_breakdown (
  device_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  provider TEXT NOT NULL,
  product TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'cli',
  model TEXT NOT NULL DEFAULT 'unknown',
  project TEXT NOT NULL DEFAULT 'unknown',
  event_count INTEGER NOT NULL DEFAULT 0,
  session_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  cost_status TEXT NOT NULL DEFAULT 'exact',
  pricing_version TEXT,
  extra_metrics_json TEXT,
  source_meta_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, usage_date, provider, product, channel, model, project),
  FOREIGN KEY (device_id, usage_date)
    REFERENCES daily_usage(device_id, usage_date)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_daily_usage_date ON daily_usage(usage_date);
CREATE INDEX IF NOT EXISTS idx_breakdown_project ON daily_usage_breakdown(project, usage_date);
CREATE INDEX IF NOT EXISTS idx_breakdown_model ON daily_usage_breakdown(model, usage_date);
CREATE INDEX IF NOT EXISTS idx_breakdown_provider_product ON daily_usage_breakdown(provider, product, usage_date);
