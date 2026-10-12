-- 1. Bo sung cac cot khoa so vao bang site_diaries
ALTER TABLE site_diaries
ADD COLUMN is_locked TINYINT(1) NOT NULL DEFAULT 0,
ADD COLUMN locked_at DATETIME NULL,
ADD COLUMN locked_by INT NULL;

-- 2. Tao bang nhat ky thao tac (Audit Log)
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(100) NOT NULL,
    reason TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tao Trigger chan sua doi khi ngay da khoa so tren MySQL
DELIMITER $$

CREATE TRIGGER trg_check_lock_items_update
BEFORE UPDATE ON site_diary_items
FOR EACH ROW
BEGIN
    DECLARE diary_locked INT DEFAULT 0;
    SELECT is_locked INTO diary_locked FROM site_diaries WHERE id = NEW.diary_id;
    IF diary_locked = 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Nhat ky ngay nay da bi khoa so. Khong the chinh sua.';
    END IF;
END$$

CREATE TRIGGER trg_check_lock_items_delete
BEFORE DELETE ON site_diary_items
FOR EACH ROW
BEGIN
    DECLARE diary_locked INT DEFAULT 0;
    SELECT is_locked INTO diary_locked FROM site_diaries WHERE id = OLD.diary_id;
    IF diary_locked = 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Nhat ky ngay nay da bi khoa so. Khong the xoa.';
    END IF;
END$$

DELIMITER ;
