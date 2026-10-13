-- Rollback Migration T50 (S-25 / SCRUM-125)

DROP TABLE IF EXISTS task_assignments;

-- Xóa liên kết team_id trên tasks trước khi drop project_teams
UPDATE tasks SET team_id = NULL;

DROP TABLE IF EXISTS project_teams;

-- Xóa cột trên tasks nếu cần
-- ALTER TABLE tasks DROP COLUMN team_id;
-- ALTER TABLE tasks DROP COLUMN assigned_by;
-- ALTER TABLE tasks DROP COLUMN assigned_at;
-- ALTER TABLE tasks DROP COLUMN assignment_note;
