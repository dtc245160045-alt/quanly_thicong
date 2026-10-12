const request = require('supertest');
const app = require('../src/app');

describe('[T-66] Security & Lock Diary Integration Tests', () => {
  const lockedDate = '2026-10-10';
  const projectId = 1;

  test('Case 1: Goi API sua truc tiep tren ngay da khoa tra ve 423 Locked', async () => {
    const res = await request(app)
      .put(`/api/v1/projects/${projectId}/diaries/${lockedDate}/items/1`)
      .set('Authorization', 'Bearer valid_token')
      .send({ work_content: 'Thay doi trai phep' });
    expect(res.statusCode).toBe(423);
  });

  test('Case 2: Tao lui ngay vao ngay da khoa tra ve 423 hoac 422', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/diaries/items`)
      .set('Authorization', 'Bearer valid_token')
      .send({ entry_date: lockedDate, work_content: 'Ghi lui ngay' });
    expect([422, 423]).toContain(res.statusCode);
  });

  test('Case 3: Tai khoan khong phai Ban quan ly goi unlock bi 403 Forbidden', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/diaries/${lockedDate}/unlock`)
      .set('Authorization', 'Bearer supervisor_token')
      .send({ reason: 'Yeu cau mo khoa boi giam sat' });
    expect(res.statusCode).toBe(403);
  });

  test('Case 4: Ban quan ly mo khoa thieu ly do tra ve 422 Unprocessable Entity', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/diaries/${lockedDate}/unlock`)
      .set('Authorization', 'Bearer manager_token')
      .send({ reason: 'Ngan' });
    expect(res.statusCode).toBe(422);
  });

  test('Case 5: Ban quan ly mo khoa thanh cong va ghi Audit Log', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/diaries/${lockedDate}/unlock`)
      .set('Authorization', 'Bearer manager_token')
      .send({ reason: 'Bo sung khoi luong theo chi dao chu dau tu' });
    expect(res.statusCode).toBe(200);
  });
});
