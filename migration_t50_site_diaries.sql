-- ========================================================
-- MIGRATION T50 & T51: BẢNG NHẬT KÝ THI CÔNG & NGÀY MƯA (S-22)
-- ========================================================

USE quanly_thicong;

-- 1. Bảng site_diaries: Mục nhật ký đầu ngày lưu thời tiết, nhân lực, thiết bị
CREATE TABLE IF NOT EXISTS `site_diaries` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `project_id` INT NOT NULL,
    `diary_date` DATE NOT NULL,
    `weather_condition` ENUM('sunny', 'cloudy', 'rain_intermittent', 'rain_all_day') NOT NULL DEFAULT 'sunny',
    `is_rain_day` TINYINT(1) NOT NULL DEFAULT 0,
    `temperature_min` DECIMAL(4, 1) NULL,
    `temperature_max` DECIMAL(4, 1) NULL,
    `weather_notes` VARCHAR(255) NULL,
    `manpower_count` INT NOT NULL DEFAULT 0,
    `equipment_status` TEXT NULL,
    `work_notes` TEXT NULL,
    `is_locked` TINYINT(1) NOT NULL DEFAULT 0,
    `locked_at` DATETIME NULL,
    `locked_by` INT NULL,
    `created_by` INT NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `uq_project_diary_date` UNIQUE KEY (`project_id`, `diary_date`),
    CONSTRAINT `fk_diary_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_diary_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    INDEX `idx_diary_project_date` (`project_id`, `diary_date`),
    INDEX `idx_diary_rain` (`project_id`, `is_rain_day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Bảng site_diary_items: Các mục công việc chi tiết trong ngày gắn hạng mục WBS (S-21)
CREATE TABLE IF NOT EXISTS `site_diary_items` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `diary_id` INT NOT NULL,
    `work_item_id` INT NULL,
    `work_content` TEXT NOT NULL,
    `quantity_done` DECIMAL(12, 2) DEFAULT 0,
    `unit` VARCHAR(50) NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_item_diary` FOREIGN KEY (`diary_id`) REFERENCES `site_diaries` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_item_work_item` FOREIGN KEY (`work_item_id`) REFERENCES `work_items` (`id`) ON DELETE SET NULL,
    INDEX `idx_item_diary` (`diary_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
