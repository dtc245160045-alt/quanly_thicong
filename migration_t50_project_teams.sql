-- Migration T50 (S-25 / SCRUM-125): Migration bảng project_teams và quản lý giao việc cho đội thi công

-- 1. Tạo bảng project_teams (Đội thi công công trường)
CREATE TABLE IF NOT EXISTS project_teams (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NULL,
  leader_id INT NULL,
  leader_name VARCHAR(100) NULL,
  phone VARCHAR(20) NULL,
  specialty VARCHAR(100) NULL,
  member_count INT NOT NULL DEFAULT 10,
  max_parallel_tasks INT NOT NULL DEFAULT 3,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (leader_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_teams_project (project_id),
  INDEX idx_teams_leader (leader_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Thêm các cột giao việc vào bảng tasks (nếu chưa có)
SET @exist_team_col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'team_id'
);
SET @sql_team_col = IF(@exist_team_col = 0, 'ALTER TABLE tasks ADD COLUMN team_id INT NULL AFTER percent_complete', 'SELECT 1');
PREPARE stmt_team FROM @sql_team_col;
EXECUTE stmt_team;
DEALLOCATE PREPARE stmt_team;

SET @exist_assigned_by = (
  SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'assigned_by'
);
SET @sql_assigned_by = IF(@exist_assigned_by = 0, 'ALTER TABLE tasks ADD COLUMN assigned_by INT NULL AFTER team_id', 'SELECT 1');
PREPARE stmt_asby FROM @sql_assigned_by;
EXECUTE stmt_asby;
DEALLOCATE PREPARE stmt_asby;

SET @exist_assigned_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'assigned_at'
);
SET @sql_assigned_at = IF(@exist_assigned_at = 0, 'ALTER TABLE tasks ADD COLUMN assigned_at DATETIME NULL AFTER assigned_by', 'SELECT 1');
PREPARE stmt_asat FROM @sql_assigned_at;
EXECUTE stmt_asat;
DEALLOCATE PREPARE stmt_asat;

SET @exist_assignment_note = (
  SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'assignment_note'
);
SET @sql_assignment_note = IF(@exist_assignment_note = 0, 'ALTER TABLE tasks ADD COLUMN assignment_note VARCHAR(255) NULL AFTER assigned_at', 'SELECT 1');
PREPARE stmt_asnote FROM @sql_assignment_note;
EXECUTE stmt_asnote;
DEALLOCATE PREPARE stmt_asnote;

-- 3. Tạo bảng task_assignments (Lịch sử giao việc cho đội thi công)
CREATE TABLE IF NOT EXISTS task_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  task_id INT NOT NULL,
  team_id INT NOT NULL,
  assigned_by INT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  note TEXT NULL,
  status ENUM('assigned', 'reassigned', 'unassigned') DEFAULT 'assigned',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES project_teams(id) ON DELETE CASCADE,
  INDEX idx_ta_project (project_id),
  INDEX idx_ta_task (task_id),
  INDEX idx_ta_team (team_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Seed 3 đội thi công mẫu cho Dự án 1
INSERT INTO project_teams (id, project_id, name, code, leader_name, phone, specialty, member_count, max_parallel_tasks, status)
VALUES
  (1, 1, 'Đội Cốp Pha & Bê Tông Móng', 'DOI-01', 'Nguyễn Văn Đội 1', '0912345678', 'Bê tông - Cốp pha', 15, 3, 'active'),
  (2, 1, 'Đội Gia Công & Lắp Dựng Cốt Thép', 'DOI-02', 'Trần Văn Cương', '0987654321', 'Cốt thép kết cấu', 12, 2, 'active'),
  (3, 1, 'Đội Xây Tô Hoàn Thiện & Điện Nước', 'DOI-03', 'Lê Văn Thợ', '0905123456', 'Xây trát - Cơ điện M&E', 10, 2, 'active')
ON DUPLICATE KEY UPDATE name = VALUES(name), leader_name = VALUES(leader_name);

-- 5. Seed gán công việc mẫu ban đầu
UPDATE tasks SET team_id = 1, assigned_by = 2, assigned_at = '2026-10-01 08:00:00' WHERE id = 1 AND project_id = 1;
UPDATE tasks SET team_id = 1, assigned_by = 2, assigned_at = '2026-10-04 08:00:00' WHERE id = 2 AND project_id = 1;
UPDATE tasks SET team_id = 2, assigned_by = 2, assigned_at = '2026-10-05 08:00:00' WHERE id = 3 AND project_id = 1;
