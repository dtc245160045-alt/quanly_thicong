-- Migration S-28 (SCRUM-120): Ban quản lý mời thành viên vào dự án và gán vai trò

-- 1. Bổ sung cột role_id vào bảng project_members nếu chưa có
SET @exist_pm_role = (
  SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_members' AND COLUMN_NAME = 'role_id'
);
SET @sql_pm_role = IF(@exist_pm_role = 0, 'ALTER TABLE project_members ADD COLUMN role_id INT NOT NULL DEFAULT 4 AFTER user_id', 'SELECT 1');
PREPARE stmt_pm_role FROM @sql_pm_role;
EXECUTE stmt_pm_role;
DEALLOCATE PREPARE stmt_pm_role;

-- 2. Bổ sung cột must_set_password vào bảng users nếu chưa có
SET @exist_user_first = (
  SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'must_set_password'
);
SET @sql_user_first = IF(@exist_user_first = 0, 'ALTER TABLE users ADD COLUMN must_set_password BOOLEAN NOT NULL DEFAULT FALSE AFTER locked_until', 'SELECT 1');
PREPARE stmt_user_first FROM @sql_user_first;
EXECUTE stmt_user_first;
DEALLOCATE PREPARE stmt_user_first;

-- 3. Tạo bảng project_invitations (Lời mời tham gia dự án)
CREATE TABLE IF NOT EXISTS project_invitations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  email VARCHAR(255) NOT NULL,
  role_id INT NOT NULL DEFAULT 4,
  invited_by INT NULL,
  status ENUM('pending', 'accepted', 'revoked') NOT NULL DEFAULT 'pending',
  token VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id),
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_inv_project (project_id),
  INDEX idx_inv_email (email),
  INDEX idx_inv_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Đồng bộ dữ liệu mặc định ban đầu: Cập nhật role_id cho thành viên mẫu dự án 1
UPDATE project_members SET role_id = 1 WHERE project_id = 1 AND user_id = 1;
UPDATE project_members SET role_id = 2 WHERE project_id = 1 AND user_id = 2;
UPDATE project_members SET role_id = 7 WHERE project_id = 1 AND user_id = 3;
