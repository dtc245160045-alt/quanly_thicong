/**
 * BỘ KIỂM THỬ: S-28 (SCRUM-120) — BAN QUẢN LÝ MỜI THÀNH VIÊN VÀO DỰ ÁN VÀ GÁN VAI TRÒ
 * User Story:
 *   “Là ban quản lý dự án tôi muốn thêm người vào dự án và gán vai trò cho họ để đội mới nhận việc không phải nhờ người quản trị hệ thống can thiệp.”
 *
 * Acceptance Criteria:
 *   AC 1: Giả sử người đó đã có tài khoản, khi tôi thêm họ vào dự án với vai trò đội trưởng, thì họ thấy dự án ngay lần tải trang kế tiếp.
 *   AC 2: Giả sử người đó chưa có tài khoản, khi tôi nhập email, thì hệ thống tạo lời mời và người đó đặt mật khẩu ở lần đăng nhập đầu.
 *   AC 3: Giả sử tôi gỡ một người khỏi dự án, khi họ gọi API dự án đó, thì bị từ chối nhưng nhật ký thao tác cũ của họ vẫn còn.
 *
 * NFR:
 *   - Không được tự gỡ chính mình nếu là ban quản lý cuối cùng của dự án.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const projectRoutes = require('../src/routes/projectRoutes');
const authController = require('../src/controllers/authController');
const {
  createSession,
  createUser,
  findUserByEmail,
  inMemoryUsers,
  inMemoryProjects,
  inMemoryProjectMembers,
  addProjectMember,
  findProjectMember,
  countProjectManagers,
  removeProjectMember
} = require('../src/models/store');
const { authenticate } = require('../src/utils/rbac');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);

  // Mock DB offline in-memory
  const mockDb = { isConnected: false, pool: null };
  app.use('/api', projectRoutes(mockDb));

  // Auth endpoints
  app.post('/api/auth/login', authController.login);
  app.post('/api/auth/register', authController.register);
  app.post('/api/auth/first-login', authController.firstLogin);

  return app;
}

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
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = text;
    }
    return { status: res.status, ok: res.ok, data };
  } finally {
    server.close();
  }
}

// Người dùng mẫu
const pmUser = findUserByEmail('dtc245160020@ictu.edu.vn'); // PM dự án 1 (id 2)
const viewerUser = findUserByEmail('viewer@thicong.vn'); // Viewer dự án 1 (id 3)
const adminUser = findUserByEmail('admin@thicong.vn'); // Admin (id 1)

const pmToken = createSession(pmUser);
const viewerToken = createSession(viewerUser);
const adminToken = createSession(adminUser);

// Đảm bảo có Project 1 và Project 2 cho kiểm thử cô lập
if (!inMemoryProjects.some(p => p.id === 1)) {
  inMemoryProjects.push({ id: 1, name: 'Dự án Thi Công Mẫu 1', code: 'DA-01' });
}
if (!inMemoryProjects.some(p => p.id === 2)) {
  inMemoryProjects.push({ id: 2, name: 'Dự án Tòa Nhà Sky Tower', code: 'DA-02' });
}

test('S-28 [AC 1]: Quản lý dự án thêm user đã tồn tại với vai trò đội trưởng thành công', async () => {
  const app = createTestApp();

  // Tạo sẵn tài khoản Đội trưởng thi công (chưa thuộc dự án 1)
  const contractorEmail = 'doitruong_ac1@thicong.vn';
  let contractor = findUserByEmail(contractorEmail);
  if (!contractor) {
    contractor = createUser({
      email: contractorEmail,
      full_name: 'Nguyễn Văn Đội Trưởng',
      role_id: 4
    });
  }

  // Ban quản lý dự án gọi POST /api/projects/1/members với vai trò đội trưởng (role_id 4)
  const res = await makeRequest(app, 'POST', '/api/projects/1/members', {
    user_id: contractor.id,
    role_id: 4
  }, pmToken);

  assert.strictEqual(res.status, 201, 'Phải trả về HTTP 201 Created');
  assert.strictEqual(res.data.success, true);
  assert.strictEqual(res.data.data.role_id, 4, 'Vai trò được gán phải là Đội trưởng thi công (role_id 4)');
  assert.strictEqual(res.data.data.user_id, contractor.id);
});

test('S-28 [AC 1]: Đội trưởng vừa được thêm nhìn thấy dự án ngay trong lần tải danh sách tiếp theo', async () => {
  const app = createTestApp();
  const contractor = findUserByEmail('doitruong_ac1@thicong.vn');
  assert.ok(contractor, 'Tài khoản đội trưởng phải tồn tại');

  const contractorToken = createSession(contractor);

  // Đội trưởng gọi GET /api/projects
  const res = await makeRequest(app, 'GET', '/api/projects', null, contractorToken);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.success, true);
  const projIds = res.data.data.map(p => p.id);
  assert.ok(projIds.includes(1), 'Đội trưởng phải thấy Dự án 1 ngay trong danh sách dự án');

  // Đội trưởng không phải là thành viên Dự án 2 nên không thấy Dự án 2
  assert.ok(!projIds.includes(2), 'Đội trưởng không được thấy Dự án 2 khi chưa được gán quyền');
});

test('S-28 [AC 2]: Mời email chưa có tài khoản, hệ thống tạo lời mời và tài khoản chờ đặt mật khẩu', async () => {
  const app = createTestApp();
  const newEmail = 'thanhvien_moi_ac2@thicong.vn';

  // Quản lý dự án mời email chưa có tài khoản
  const res = await makeRequest(app, 'POST', '/api/projects/1/members', {
    email: newEmail,
    role_id: 4 // Đội trưởng thi công
  }, pmToken);

  assert.strictEqual(res.status, 201, 'Phải tạo lời mời thành công (HTTP 201)');
  assert.strictEqual(res.data.success, true);
  assert.strictEqual(res.data.data.email, newEmail);
  assert.strictEqual(res.data.data.status, 'pending');

  // Kiểm tra tài khoản được tạo với cờ must_set_password = true
  const createdUser = findUserByEmail(newEmail);
  assert.ok(createdUser, 'User mới phải được tạo tạm thời để chờ đặt mật khẩu');
  assert.strictEqual(createdUser.must_set_password, true, 'User phải có cờ must_set_password = true');
});

test('S-28 [AC 2]: Người được mời nhập mật khẩu dưới 6 ký tự ở lần đăng nhập đầu bị từ chối', async () => {
  const app = createTestApp();
  const newEmail = 'thanhvien_moi_ac2@thicong.vn';

  // Đăng nhập lần đầu với mật khẩu quá ngắn
  const res = await makeRequest(app, 'POST', '/api/auth/login', {
    email: newEmail,
    password: '123'
  });

  assert.strictEqual(res.status, 400, 'Phải trả về 400 khi mật khẩu dưới 6 ký tự');
  assert.strictEqual(res.data.success, false);
  assert.ok(res.data.message.includes('6 ký tự'));
});

test('S-28 [AC 2]: Người được mời đặt mật khẩu ở lần đăng nhập đầu thành công và được kích hoạt', async () => {
  const app = createTestApp();
  const newEmail = 'thanhvien_moi_ac2@thicong.vn';

  // Đăng nhập lần đầu với mật khẩu hợp lệ
  const res = await makeRequest(app, 'POST', '/api/auth/login', {
    email: newEmail,
    password: 'MatKhauMoi@123'
  });

  assert.strictEqual(res.status, 200, 'Đăng nhập và đặt mật khẩu lần đầu phải thành công (HTTP 200)');
  assert.strictEqual(res.data.success, true);
  assert.ok(res.data.token, 'Phải trả về token phiên làm việc');

  // Kiểm tra cờ must_set_password đã tắt
  const activatedUser = findUserByEmail(newEmail);
  assert.strictEqual(activatedUser.must_set_password, false, 'Cờ must_set_password phải được xóa');

  // Kiểm tra thành viên đã được tự động thêm vào Dự án 1
  const member = findProjectMember(1, activatedUser.id);
  assert.ok(member, 'Người dùng phải được kích hoạt thành viên trong Dự án 1');
  assert.strictEqual(member.role_id, 4, 'Vai trò trong dự án phải là Đội trưởng thi công');

  // Đăng nhập lại lần sau với mật khẩu vừa đặt
  const resSecondLogin = await makeRequest(app, 'POST', '/api/auth/login', {
    email: newEmail,
    password: 'MatKhauMoi@123'
  });
  assert.strictEqual(resSecondLogin.status, 200, 'Lần đăng nhập tiếp theo phải khớp mật khẩu đã đặt');

  // Kiểm tra gọi GET /api/projects thấy dự án 1
  const resProj = await makeRequest(app, 'GET', '/api/projects', null, resSecondLogin.data.token);
  assert.strictEqual(resProj.status, 200);
  const projIds = resProj.data.data.map(p => p.id);
  assert.ok(projIds.includes(1), 'Người dùng phải thấy dự án được mời');
});

test('S-28 [AC 3]: Gỡ thành viên khỏi dự án và chặn API dự án đó ở request tiếp theo', async () => {
  const app = createTestApp();

  // Tạo user thử nghiệm để gỡ
  const testEmail = 'user_to_remove@thicong.vn';
  const removeUser = createUser({
    email: testEmail,
    full_name: 'Người Sắp Bị Gỡ',
    role_id: 3 // Kỹ sư giám sát
  });
  addProjectMember({ projectId: 1, userId: removeUser.id, roleId: 3 });

  const tokenBefore = createSession(removeUser);

  // Trước khi gỡ: gọi API Dự án 1 thành công
  const resBefore = await makeRequest(app, 'GET', '/api/projects/1', null, tokenBefore);
  assert.strictEqual(resBefore.status, 200, 'Trước khi gỡ phải xem được dự án');

  // Ban quản lý dự án gọi DELETE /api/projects/1/members/:userId
  const resDelete = await makeRequest(app, 'DELETE', `/api/projects/1/members/${removeUser.id}`, null, pmToken);
  assert.strictEqual(resDelete.status, 200, 'Gỡ thành viên phải thành công (HTTP 200)');
  assert.strictEqual(resDelete.data.success, true);

  // Sau khi bị gỡ: gọi API Dự án 1 ngay lập tức bị từ chối HTTP 403 Forbidden
  const resAfter = await makeRequest(app, 'GET', '/api/projects/1', null, tokenBefore);
  assert.strictEqual(resAfter.status, 403, 'Sau khi bị gỡ phải bị chặn HTTP 403 Forbidden');
  assert.strictEqual(resAfter.data.success, false);

  // Gọi danh sách dự án không còn thấy Dự án 1
  const resList = await makeRequest(app, 'GET', '/api/projects', null, tokenBefore);
  assert.strictEqual(resList.status, 200);
  const projIds = resList.data.data.map(p => p.id);
  assert.ok(!projIds.includes(1), 'Dự án đã gỡ không được xuất hiện trong danh sách');

  // User không bị xóa khỏi hệ thống
  const userStillExists = findUserByEmail(testEmail);
  assert.ok(userStillExists, 'Tài khoản người dùng không được phép bị xóa khỏi CSDL');
});

test('S-28 [NFR]: Không được tự gỡ chính mình nếu là ban quản lý cuối cùng của dự án', async () => {
  const app = createTestApp();

  // Đảm bảo Dự án 1 chỉ còn đúng 1 ban quản lý là pmUser (id 2)
  const currentMembers = inMemoryProjectMembers.filter(m => m.project_id === 1);
  for (const m of currentMembers) {
    if (m.role_id === 2 && m.user_id !== pmUser.id) {
      removeProjectMember({ projectId: 1, userId: m.user_id });
    }
  }

  const managerCount = countProjectManagers(1);
  assert.strictEqual(managerCount, 1, 'Dự án 1 phải có đúng 1 ban quản lý duy nhất');

  // Ban quản lý duy nhất tự gỡ chính mình
  const res = await makeRequest(app, 'DELETE', `/api/projects/1/members/${pmUser.id}`, null, pmToken);

  assert.strictEqual(res.status, 400, 'Phải chặn không cho tự gỡ ban quản lý cuối cùng (HTTP 400)');
  assert.strictEqual(res.data.success, false);
  assert.ok(res.data.message.includes('ban quản lý cuối cùng'), 'Thông báo phải nêu rõ ban quản lý cuối cùng');

  // Kiểm tra membership của pmUser vẫn nguyên vẹn
  const memberAfter = findProjectMember(1, pmUser.id);
  assert.ok(memberAfter, 'Ban quản lý cuối cùng vẫn phải còn trong dự án');
  assert.strictEqual(memberAfter.role_id, 2);
});

test('S-28 [NFR]: Cho phép quản lý tự gỡ mình khi dự án còn ban quản lý khác', async () => {
  const app = createTestApp();

  // Thêm một PM thứ hai vào Dự án 1
  const secondPm = createUser({
    email: 'second_pm@thicong.vn',
    full_name: 'Quản Lý Thứ Hai',
    role_id: 2
  });
  addProjectMember({ projectId: 1, userId: secondPm.id, roleId: 2 });

  const managerCount = countProjectManagers(1);
  assert.ok(managerCount >= 2, 'Dự án phải có từ 2 ban quản lý trở lên');

  const secondPmToken = createSession(secondPm);

  // Quản lý thứ hai tự gỡ chính mình
  const res = await makeRequest(app, 'DELETE', `/api/projects/1/members/${secondPm.id}`, null, secondPmToken);

  assert.strictEqual(res.status, 200, 'Khi còn quản lý khác thì được phép tự rời dự án (HTTP 200)');
  assert.strictEqual(res.data.success, true);

  // Kiểm tra secondPm đã rời dự án
  const memberAfter = findProjectMember(1, secondPm.id);
  assert.strictEqual(memberAfter, null, 'Second PM phải bị xóa khỏi thành viên dự án 1');
});

test('S-28 [Bảo mật]: Chưa đăng nhập gọi API quản lý thành viên bị từ chối HTTP 401', async () => {
  const app = createTestApp();

  const resPost = await makeRequest(app, 'POST', '/api/projects/1/members', { email: 'test@thicong.vn' });
  assert.strictEqual(resPost.status, 401, 'POST /members chưa đăng nhập phải trả về 401');

  const resDelete = await makeRequest(app, 'DELETE', '/api/projects/1/members/3');
  assert.strictEqual(resDelete.status, 401, 'DELETE /members chưa đăng nhập phải trả về 401');

  const resPut = await makeRequest(app, 'PUT', '/api/projects/1/members/3', { role_id: 4 });
  assert.strictEqual(resPut.status, 401, 'PUT /members chưa đăng nhập phải trả về 401');
});

test('S-28 [Bảo mật]: Người không có quyền quản lý (Viewer / Contractor) gọi API quản lý thành viên bị 403', async () => {
  const app = createTestApp();

  // Viewer gọi POST /members
  const resPost = await makeRequest(app, 'POST', '/api/projects/1/members', {
    email: 'newuser@thicong.vn',
    role_id: 4
  }, viewerToken);
  assert.strictEqual(resPost.status, 403, 'Viewer gọi POST /members phải trả về 403');

  // Viewer gọi DELETE /members
  const resDelete = await makeRequest(app, 'DELETE', '/api/projects/1/members/2', null, viewerToken);
  assert.strictEqual(resDelete.status, 403, 'Viewer gọi DELETE /members phải trả về 403');

  // Đội trưởng (contractor) gọi POST /members
  const contractor = findUserByEmail('doitruong_ac1@thicong.vn');
  const contractorToken = createSession(contractor);
  const resContractor = await makeRequest(app, 'POST', '/api/projects/1/members', {
    email: 'someuser@thicong.vn',
    role_id: 4
  }, contractorToken);
  assert.strictEqual(resContractor.status, 403, 'Đội trưởng gọi POST /members phải trả về 403');
});

test('S-28 [Bảo mật]: User của Dự án 1 cố gắng quản lý thành viên của Dự án 2 bị chặn 403', async () => {
  const app = createTestApp();

  // pmUser chỉ là quản lý của Dự án 1, không có quyền quản lý Dự án 2
  const res = await makeRequest(app, 'POST', '/api/projects/2/members', {
    email: 'someone@thicong.vn',
    role_id: 4
  }, pmToken);

  assert.strictEqual(res.status, 403, 'Quản lý dự án A không được phép quản lý thành viên dự án B (HTTP 403)');
  assert.strictEqual(res.data.success, false);
});

test('S-28 [Bảo mật]: Chặn gán vai trò Admin hệ thống (role_id 1) thông qua lời mời/thêm thành viên', async () => {
  const app = createTestApp();

  const res = await makeRequest(app, 'POST', '/api/projects/1/members', {
    email: 'hacker@thicong.vn',
    role_id: 1 // Cố gán Admin hệ thống
  }, pmToken);

  assert.strictEqual(res.status, 400, 'Phải chặn không cho gán quyền admin hệ thống (HTTP 400)');
  assert.strictEqual(res.data.success, false);
  assert.ok(res.data.message.includes('quản trị viên hệ thống'));
});

test('S-28 [Validation]: Email thiếu hoặc định dạng sai trả về HTTP 400', async () => {
  const app = createTestApp();

  const resEmpty = await makeRequest(app, 'POST', '/api/projects/1/members', {}, pmToken);
  assert.strictEqual(resEmpty.status, 400);

  const resInvalid = await makeRequest(app, 'POST', '/api/projects/1/members', {
    email: 'sai-dinh-dang-email'
  }, pmToken);
  assert.strictEqual(resInvalid.status, 400);
});

test('S-28 [Validation]: Mời hoặc thêm trùng thành viên đã có trong dự án trả về HTTP 409', async () => {
  const app = createTestApp();

  // pmUser đã là thành viên dự án 1
  const res = await makeRequest(app, 'POST', '/api/projects/1/members', {
    user_id: pmUser.id,
    role_id: 4
  }, pmToken);

  assert.strictEqual(res.status, 409, 'Thêm thành viên trùng phải trả về 409 Conflict');
  assert.strictEqual(res.data.success, false);
  assert.ok(res.data.message.includes('đã là thành viên'));
});

test('S-28 [Validation]: Đăng ký công khai không cho phép tự phong quyền Admin (chặn role_id 1)', async () => {
  const app = createTestApp();

  const res = await makeRequest(app, 'POST', '/api/auth/register', {
    full_name: 'Nguyễn Tự Phong',
    email: 'tuphongadmin@thicong.vn',
    password: 'Password@123',
    role_id: 1 // Cố gắng đăng ký làm admin
  });

  assert.strictEqual(res.status, 201);
  const created = findUserByEmail('tuphongadmin@thicong.vn');
  assert.notStrictEqual(created.role_id, 1, 'Hệ thống không được gán quyền Admin khi đăng ký');
  assert.strictEqual(created.role_id, 2, 'Hệ thống phải hạ quyền xuống role bình thường');
});

test('S-28 [Validation]: projectId không tồn tại trả về lỗi 404', async () => {
  const app = createTestApp();

  const res = await makeRequest(app, 'GET', '/api/projects/9999/members', null, adminToken);
  assert.strictEqual(res.status, 404, 'Dự án không tồn tại phải trả về 404');
  assert.strictEqual(res.data.success, false);
});

test('S-28 [Tính năng]: Quản lý đổi vai trò thành viên và chặn hạ quyền ban quản lý cuối cùng', async () => {
  const app = createTestApp();

  // Tạo một thành viên là Kỹ sư giám sát (role 3)
  const engEmail = 'engineer_role_change@thicong.vn';
  const engUser = createUser({
    email: engEmail,
    full_name: 'Kỹ Sư Đổi Vai Trò',
    role_id: 3
  });
  addProjectMember({ projectId: 1, userId: engUser.id, roleId: 3 });

  // Đổi vai trò thành Kế toán (role 5)
  const resPut = await makeRequest(app, 'PUT', `/api/projects/1/members/${engUser.id}`, {
    role_id: 5
  }, pmToken);

  assert.strictEqual(resPut.status, 200, 'Đổi vai trò thành viên phải thành công (HTTP 200)');
  assert.strictEqual(resPut.data.success, true);

  const updatedMember = findProjectMember(1, engUser.id);
  assert.strictEqual(updatedMember.role_id, 5, 'Vai trò trong dự án phải là 5');

  // Thử hạ quyền ban quản lý duy nhất (pmUser) sang vai trò khác -> Bị chặn
  const resDowngradePm = await makeRequest(app, 'PUT', `/api/projects/1/members/${pmUser.id}`, {
    role_id: 4
  }, pmToken);
  assert.strictEqual(resDowngradePm.status, 400, 'Không được hạ quyền ban quản lý cuối cùng');
});

test('S-28 [Tính năng]: Endpoint /api/projects/:id/invitations tạo và lấy danh sách lời mời', async () => {
  const app = createTestApp();
  const inviteEmail = 'dedicated_invite@thicong.vn';

  // POST /api/projects/1/invitations
  const resPost = await makeRequest(app, 'POST', '/api/projects/1/invitations', {
    email: inviteEmail,
    role: 'contractor'
  }, pmToken);

  assert.strictEqual(resPost.status, 201);
  assert.strictEqual(resPost.data.success, true);
  assert.strictEqual(resPost.data.data.email, inviteEmail);

  // GET /api/projects/1/invitations
  const resGet = await makeRequest(app, 'GET', '/api/projects/1/invitations', null, pmToken);
  assert.strictEqual(resGet.status, 200);
  assert.strictEqual(resGet.data.success, true);
  assert.ok(Array.isArray(resGet.data.data));
  const emails = resGet.data.data.map(i => i.email);
  assert.ok(emails.includes(inviteEmail), 'Danh sách lời mời phải chứa email vừa mời');
});

test('S-28 [Tính năng]: Endpoint /api/auth/first-login hỗ trợ đặt mật khẩu lần đầu trực tiếp', async () => {
  const app = createTestApp();
  const inviteEmail = 'first_login_direct@thicong.vn';

  // Quản lý mời email
  await makeRequest(app, 'POST', '/api/projects/1/invitations', {
    email: inviteEmail,
    role_id: 4
  }, pmToken);

  // Gọi endpoint /api/auth/first-login
  const resFirstLogin = await makeRequest(app, 'POST', '/api/auth/first-login', {
    email: inviteEmail,
    password: 'SecurePass@123',
    confirm_password: 'SecurePass@123'
  });

  assert.strictEqual(resFirstLogin.status, 200, 'Đặt mật khẩu lần đầu trực tiếp phải thành công');
  assert.strictEqual(resFirstLogin.data.success, true);
  assert.ok(resFirstLogin.data.token);

  // Kiểm tra user có thể dùng token để xem dự án 1
  const resProj = await makeRequest(app, 'GET', '/api/projects/1', null, resFirstLogin.data.token);
  assert.strictEqual(resProj.status, 200, 'Sau khi kích hoạt phải xem được Dự án 1');
});

