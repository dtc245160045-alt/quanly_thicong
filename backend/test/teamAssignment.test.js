/**
 * BỘ KIỂM THỬ: S-25 (SCRUM-117) — CHỈ HUY TRƯỞNG GIAO CÔNG VIỆC CHO ĐỘI THI CÔNG
 * Subtask 1: SCRUM-125 [T-50] Migration bảng project_teams và API gán công việc cho đội
 * Subtask 2: SCRUM-126 [T-51] Màn hình chỉ huy trưởng giao việc cho đội và cảnh báo quá tải
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const teamRoutes = require('../src/routes/teamRoutes');
const { createSession, inMemoryUsers } = require('../src/models/store');
const { authenticate } = require('../src/utils/rbac');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);

  // Giả lập đối tượng DB dạng in-memory
  const mockDb = { isConnected: false, pool: null };
  app.use('/api', teamRoutes(mockDb));
  return app;
}

// Token người dùng phục vụ test
const adminUser = inMemoryUsers.find(u => u.role_id === 1) || { id: 1, email: 'admin@thicong.vn', role_id: 1, role_name: 'admin' };
const pmUser = inMemoryUsers.find(u => u.role_id === 2) || { id: 2, email: 'dtc245160020@ictu.edu.vn', role_id: 2, role_name: 'project_manager' };
const viewerUser = inMemoryUsers.find(u => u.role_id === 7) || { id: 3, email: 'viewer@thicong.vn', role_id: 7, role_name: 'viewer' };

const adminToken = createSession(adminUser);
const pmToken = createSession(pmUser);
const viewerToken = createSession(viewerUser);

// Helper fetch request
async function makeRequest(app, method, url, body = null, token = null) {
  const server = app.listen(0);
  const port = server.address().port;
  const targetUrl = `http://localhost:${port}${url}`;

  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(targetUrl, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null
    });
    const status = res.status;
    let data;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status, data };
  } finally {
    server.close();
  }
}

test('S-25 [T-50] Test 1: Lấy danh sách đội thi công dự án mẫu 1 kèm chỉ số tải trọng', async () => {
  const app = createTestApp();
  const res = await makeRequest(app, 'GET', '/api/projects/1/teams', null, pmToken);

  assert.equal(res.status, 200);
  assert.equal(res.data.success, true);
  assert.ok(Array.isArray(res.data.data), 'Danh sách đội phải là mảng');
  assert.ok(res.data.data.length >= 3, 'Dự án 1 phải có ít nhất 3 đội thi công mẫu');

  const team1 = res.data.data.find(t => t.id === 1);
  assert.ok(team1, 'Đội 1 phải tồn tại');
  assert.equal(team1.name, 'Đội Cốp Pha & Bê Tông Móng');
  assert.ok(typeof team1.task_count === 'number', 'Phải có chỉ số task_count');
  assert.ok(typeof team1.active_task_count === 'number', 'Phải có chỉ số active_task_count');
  assert.ok(typeof team1.max_parallel_tasks === 'number', 'Phải có max_parallel_tasks');
  assert.ok(typeof team1.is_overloaded === 'boolean', 'Phải có cờ is_overloaded');
  assert.ok(['normal', 'full', 'overloaded'].includes(team1.workload_status), 'workload_status phải hợp lệ');
});

test('S-25 [T-50] Test 2: Tạo đội thi công mới với thông tin hợp lệ', async () => {
  const app = createTestApp();
  const payload = {
    name: 'Đội Thi Công Sơn Bả & Chống Thấm',
    code: 'DOI-04',
    leader_name: 'Phạm Văn Sơn',
    phone: '0933112233',
    specialty: 'Sơn bả - Hoàn thiện',
    member_count: 8,
    max_parallel_tasks: 2
  };

  const res = await makeRequest(app, 'POST', '/api/projects/1/teams', payload, pmToken);
  assert.equal(res.status, 201);
  assert.equal(res.data.success, true);
  assert.equal(res.data.data.name, payload.name);
  assert.equal(res.data.data.max_parallel_tasks, 2);
  assert.equal(res.data.data.member_count, 8);
});

test('S-25 [T-50] Test 3: Validation từ chối khi tên đội để trống hoặc max_parallel_tasks không hợp lệ', async () => {
  const app = createTestApp();
  // Tên trống
  const resEmptyName = await makeRequest(app, 'POST', '/api/projects/1/teams', { name: '' }, pmToken);
  assert.equal(resEmptyName.status, 400);
  assert.equal(resEmptyName.data.success, false);

  // max_parallel_tasks âm hoặc bằng 0
  const resInvalidMax = await makeRequest(app, 'POST', '/api/projects/1/teams', { name: 'Đội Test', max_parallel_tasks: -1 }, pmToken);
  assert.equal(resInvalidMax.status, 400);
  assert.equal(resInvalidMax.data.success, false);
});

test('S-25 [T-50] Test 4: Chỉ huy trưởng giao công việc cho đội thi công thành công', async () => {
  const app = createTestApp();
  // Giao task 6 cho Đội 1
  const payload = {
    team_id: 1,
    note: 'Đẩy nhanh tiến độ thi công móng'
  };

  const res = await makeRequest(app, 'POST', '/api/projects/1/tasks/6/assign', payload, pmToken);
  assert.equal(res.status, 200);
  assert.equal(res.data.success, true);
  assert.equal(res.data.task.team_id, 1);
  assert.equal(res.data.task.assignment_note, payload.note);
  assert.ok(res.data.task.assigned_at, 'Phải có thời điểm giao việc assigned_at');
});

test('S-25 [T-50] Test 5: Từ chối khi giao việc cho task hoặc team không tồn tại trong dự án', async () => {
  const app = createTestApp();
  // Task không tồn tại
  const resNoTask = await makeRequest(app, 'POST', '/api/projects/1/tasks/9999/assign', { team_id: 1 }, pmToken);
  assert.equal(resNoTask.status, 404);

  // Team không tồn tại
  const resNoTeam = await makeRequest(app, 'POST', '/api/projects/1/tasks/1/assign', { team_id: 9999 }, pmToken);
  assert.equal(resNoTeam.status, 404);
});

test('S-25 [T-51] Test 6: Phát hiện và cảnh báo quá tải khi đội nhận vượt định mức max_parallel_tasks', async () => {
  const app = createTestApp();
  // Tạo 1 đội có max_parallel_tasks = 1
  const createRes = await makeRequest(app, 'POST', '/api/projects/1/teams', {
    name: 'Đội Cơ Điện Nhỏ',
    max_parallel_tasks: 1
  }, pmToken);
  assert.equal(createRes.status, 201);
  const smallTeamId = createRes.data.data.id;

  // Giao việc thứ 1 -> Chưa quá tải (1/1 việc active)
  const res1 = await makeRequest(app, 'POST', '/api/projects/1/tasks/4/assign', { team_id: smallTeamId }, pmToken);
  assert.equal(res1.status, 200);
  assert.equal(res1.data.is_overloaded, false);

  // Giao tiếp việc thứ 2 (task 5 chưa hoàn thành) -> VƯỢT ĐỊNH MỨC (2/1 việc) => QUÁ TẢI
  const res2 = await makeRequest(app, 'POST', '/api/projects/1/tasks/5/assign', { team_id: smallTeamId }, pmToken);
  assert.equal(res2.status, 200);
  assert.equal(res2.data.is_overloaded, true, 'is_overloaded phải là true khi vượt định mức');
  assert.ok(res2.data.warning, 'Phải có thông điệp warning cảnh báo quá tải');
  assert.ok(res2.data.warning.includes('Cảnh báo quá tải'), 'Thông điệp phải chứa cụm từ cảnh báo quá tải');
  assert.equal(res2.data.active_task_count, 2);
  assert.equal(res2.data.max_parallel_tasks, 1);
});

test('S-25 [T-50] Test 7: Hủy giao việc (unassign) thành công, cập nhật tải trọng đội giảm xuống', async () => {
  const app = createTestApp();
  // Giao task 7 cho Đội 3
  await makeRequest(app, 'POST', '/api/projects/1/tasks/7/assign', { team_id: 3 }, pmToken);

  // Hủy giao việc task 7
  const unassignRes = await makeRequest(app, 'POST', '/api/projects/1/tasks/7/unassign', null, pmToken);
  assert.equal(unassignRes.status, 200);
  assert.equal(unassignRes.data.success, true);
  assert.equal(unassignRes.data.data.team_id, null, 'Sau khi unassign, team_id phải bằng null');
});

test('S-25 [T-51] Test 8: Báo cáo phân bổ tải trọng tổng thể các đội (team-workload)', async () => {
  const app = createTestApp();
  const res = await makeRequest(app, 'GET', '/api/projects/1/team-workload', null, pmToken);

  assert.equal(res.status, 200);
  assert.equal(res.data.success, true);
  assert.ok(res.data.total_teams >= 3, 'Phải có ít nhất 3 đội');
  assert.ok(typeof res.data.overloaded_teams_count === 'number', 'Phải có số lượng đội quá tải');
  assert.ok(typeof res.data.total_tasks_assigned === 'number', 'Phải có tổng số task đã gán');
  assert.ok(typeof res.data.has_overload_alert === 'boolean', 'Phải có cờ has_overload_alert');
  assert.ok(Array.isArray(res.data.teams), 'Phải có danh sách teams');
});

test('S-25 [RBAC] Test 9: Phân quyền - Người xem dự án (viewer) bị từ chối HTTP 403 Forbidden', async () => {
  const app = createTestApp();
  // Viewer cố tạo đội -> 403
  const createRes = await makeRequest(app, 'POST', '/api/projects/1/teams', { name: 'Đội Của Viewer' }, viewerToken);
  assert.equal(createRes.status, 403);
  assert.equal(createRes.data.success, false);

  // Viewer cố giao việc -> 403
  const assignRes = await makeRequest(app, 'POST', '/api/projects/1/tasks/1/assign', { team_id: 1 }, viewerToken);
  assert.equal(assignRes.status, 403);
  assert.equal(assignRes.data.success, false);

  // Viewer cố hủy giao việc -> 403
  const unassignRes = await makeRequest(app, 'POST', '/api/projects/1/tasks/1/unassign', null, viewerToken);
  assert.equal(unassignRes.status, 403);

  // Viewer cố xóa đội -> 403
  const deleteRes = await makeRequest(app, 'DELETE', '/api/projects/1/teams/1', null, viewerToken);
  assert.equal(deleteRes.status, 403);

  // Nhưng Viewer VẪN ĐƯỢC XEM danh sách đội (HTTP 200)
  const readRes = await makeRequest(app, 'GET', '/api/projects/1/teams', null, viewerToken);
  assert.equal(readRes.status, 200);
});

test('S-25 [T-50] Test 10: API assigned-tasks trả về đầy đủ thông tin công việc và đội thi công', async () => {
  const app = createTestApp();
  const res = await makeRequest(app, 'GET', '/api/projects/1/assigned-tasks', null, pmToken);

  assert.equal(res.status, 200);
  assert.equal(res.data.success, true);
  assert.ok(Array.isArray(res.data.data), 'Kết quả phải là mảng');
  assert.ok(res.data.data.length > 0, 'Phải có công việc');

  const taskWithTeam = res.data.data.find(t => t.team_id !== null);
  assert.ok(taskWithTeam, 'Phải có ít nhất 1 task đã được gán đội thi công');
  assert.ok(taskWithTeam.team_name, 'Phải có trường team_name');
});
