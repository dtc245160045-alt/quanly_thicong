-- Rollback S-28: Gỡ bỏ bảng lời mời và các cột liên quan
DROP TABLE IF EXISTS project_invitations;

SET @exist_user_first = (
  SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'must_set_password'
);
SET @sql_user_first = IF(@exist_user_first > 0, 'ALTER TABLE users DROP COLUMN must_set_password', 'SELECT 1');
PREPARE stmt_user_first FROM @sql_user_first;
EXECUTE stmt_user_first;
DEALLOCATE PREPARE stmt_user_first;

SET @exist_pm_role = (
  SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_members' AND COLUMN_NAME = 'role_id'
);
SET @sql_pm_role = IF(@exist_pm_role > 0, 'ALTER TABLE project_members DROP COLUMN role_id', 'SELECT 1');
PREPARE stmt_pm_role FROM @sql_pm_role;
EXECUTE stmt_pm_role;
DEALLOCATE PREPARE stmt_pm_role;
