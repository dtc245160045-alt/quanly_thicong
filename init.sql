USE quanly_thicong;

CREATE TABLE IF NOT EXISTS roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

INSERT IGNORE INTO roles (id, name) VALUES 
(1, 'Admin'), 
(2, 'Kỹ sư'), 
(3, 'Thầu phụ');

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role_id INT DEFAULT 2,
    failed_attempts INT DEFAULT 0,
    locked_until DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- Seed tài khoản mẫu: admin@thicong.vn / mật khẩu: 123456 (đã băm bằng bcrypt)
INSERT IGNORE INTO users (id, email, password, full_name, role_id) 
VALUES (1, 'admin@thicong.vn', '$2b$10$wT2Hl7J4b7h5I5x9M9L8xe6k3p5F6N3v3K9g0E7t2Z1y8x7w6v5u4', 'Nguyễn Đức Hiếu', 1);

-- Bảng calendars lưu cấu hình lịch làm việc của từng dự án (S-17 / T-38)
CREATE TABLE IF NOT EXISTS calendars (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    work_days_per_week TINYINT NOT NULL DEFAULT 6,
    working_days_mask VARCHAR(50) NOT NULL DEFAULT '1,2,3,4,5,6',
    description VARCHAR(255) DEFAULT 'Lịch thi công công trường (Mặc định 6 ngày/tuần, nghỉ CN)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_project_calendar (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Bảng holidays lưu danh sách ngày nghỉ lễ theo dự án (S-17 / T-38)
CREATE TABLE IF NOT EXISTS holidays (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NULL,
    name VARCHAR(255) NOT NULL,
    holiday_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_project_holiday (project_id, holiday_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed lịch làm việc mặc định 6 ngày/tuần cho dự án 1
INSERT INTO calendars (project_id, work_days_per_week, working_days_mask, description)
VALUES (1, 6, '1,2,3,4,5,6', 'Lịch làm việc mặc định công trường 6 ngày/tuần, nghỉ Chủ Nhật')
ON DUPLICATE KEY UPDATE 
    work_days_per_week = VALUES(work_days_per_week),
    working_days_mask = VALUES(working_days_mask);

