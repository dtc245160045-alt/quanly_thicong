-- ========================================================
-- MIGRATION T52: BẢNG ẢNH ĐÍNH KÈM NHẬT KÝ THI CÔNG (S-23)
-- ========================================================

USE quanly_thicong;

-- Tạo bảng lưu ảnh đính kèm nhật ký thi công
CREATE TABLE IF NOT EXISTS `site_diary_photos` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `diary_id` INT NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `file_path` VARCHAR(500) NOT NULL,
    `file_size` INT NOT NULL,
    `mime_type` VARCHAR(100) NOT NULL,
    `caption` VARCHAR(255) NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_photo_diary` FOREIGN KEY (`diary_id`) REFERENCES `site_diaries` (`id`) ON DELETE CASCADE,
    INDEX `idx_photo_diary` (`diary_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
