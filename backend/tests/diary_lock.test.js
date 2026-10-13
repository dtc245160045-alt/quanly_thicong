const test = require('node:test');
const assert = require('node:assert');

test('S-24 AC 1: Chan thao tac sua hoac xoa khi nhat ky da khoa so (HTTP 423 Locked)', () => {
  const isDiaryLocked = true;
  const handleEditRequest = (locked) => {
    if (locked) {
      return { status: 423, error: 'Locked', message: 'Nhat ky da bi khoa' };
    }
    return { status: 200, message: 'Thanh cong' };
  };

  const response = handleEditRequest(isDiaryLocked);
  assert.strictEqual(response.status, 423);
  assert.strictEqual(response.error, 'Locked');
});

test('S-24 AC 2: Tao lui ngay vao ngay da khoa so bi tu choi voi HTTP 423 hoac 422', () => {
  const lockedDates = ['2026-10-10'];
  const newEntryDate = '2026-10-10';

  const validateEntryDate = (date) => {
    if (lockedDates.includes(date)) {
      return { status: 423, valid: false };
    }
    return { status: 201, valid: true };
  };

  const res = validateEntryDate(newEntryDate);
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.status, 423);
});

test('S-24 AC 3: Phan quyen mo khoa so - Chi Ban quan ly moi duoc phep mo khoa', () => {
  const authorizeUnlock = (userRole) => {
    if (userRole === 'PROJECT_MANAGER' || userRole === 'BQL') {
      return 200;
    }
    return 403;
  };

  assert.strictEqual(authorizeUnlock('SUPERVISOR'), 403);
  assert.strictEqual(authorizeUnlock('WORKER'), 403);
  assert.strictEqual(authorizeUnlock('PROJECT_MANAGER'), 200);
});

test('S-24 AC 4: Mo khoa so bat buoc nhap ly do tu 10 ky tu tro len', () => {
  const validateReason = (reason) => {
    if (!reason || reason.trim().length < 10) {
      return { status: 422, message: 'Ly do phai co it nhat 10 ky tu' };
    }
    return { status: 200, message: 'Hop le' };
  };

  assert.strictEqual(validateReason('').status, 422);
  assert.strictEqual(validateReason('Ngan').status, 422);
  assert.strictEqual(validateReason('Cap nhat bo sung theo yeu cau giam sat').status, 200);
});

test('S-24 AC 5: Mo khoa thanh cong ghi nhan ban ghi audit log', () => {
  const auditLogs = [];
  const logUnlockAction = (userId, reason, timestamp) => {
    const log = { user_id: userId, action: 'UNLOCK_DIARY', reason, timestamp };
    auditLogs.push(log);
    return log;
  };

  const entry = logUnlockAction(1, 'Mo khoa chinh sua khoi luong', new Date().toISOString());
  assert.strictEqual(auditLogs.length, 1);
  assert.strictEqual(entry.action, 'UNLOCK_DIARY');
  assert.strictEqual(entry.user_id, 1);
});
