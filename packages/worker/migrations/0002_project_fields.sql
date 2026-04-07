-- Project 三字段模型：project(完整路径/主键) + project_display(basename) + project_alias(别名)
ALTER TABLE daily_usage_breakdown ADD COLUMN project_display TEXT;
ALTER TABLE daily_usage_breakdown ADD COLUMN project_alias TEXT;

-- 回填：现有 project 值为 basename，复制到 project_display
UPDATE daily_usage_breakdown SET project_display = project WHERE project_display IS NULL;

-- 索引
CREATE INDEX IF NOT EXISTS idx_breakdown_project_display ON daily_usage_breakdown(project_display, usage_date);
CREATE INDEX IF NOT EXISTS idx_breakdown_project_alias ON daily_usage_breakdown(project_alias, usage_date);
