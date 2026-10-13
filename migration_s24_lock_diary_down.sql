DROP TRIGGER IF EXISTS trg_check_lock_items_update;
DROP TRIGGER IF EXISTS trg_check_lock_items_delete;

ALTER TABLE site_diaries
DROP COLUMN is_locked,
DROP COLUMN locked_at,
DROP COLUMN locked_by;

DROP TABLE IF EXISTS audit_logs;
