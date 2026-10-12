const test = require('node:test');
const assert = require('node:assert/strict');
const { MilestoneAlertService } = require('../src/services/milestoneAlertService');
const { SchedulerService } = require('../src/domain/scheduling/schedulerService');
const {
  inMemoryWorkItems,
  inMemoryMilestones,
  inMemoryMilestoneAlerts,
  createMilestoneData
} = require('../src/models/store');

test('T-45 TEST 1 & TEST 2: Milestone đang vượt → service trả đúng cảnh báo kèm title, dueDate, actualEarlyFinish, overdueWorkdays', async () => {
  inMemoryMilestoneAlerts.length = 0;
  inMemoryMilestones.length = 0;
  inMemoryWorkItems.length = 0;

  inMemoryWorkItems.push({ id: 1, project_id: 1, parent_id: null, name: 'Hạng mục Móng', code: 'HM-01' });

  createMilestoneData({
    work_item_id: 1,
    due_date: '2026-10-09',
    title: 'Bàn giao móng',
    created_by: 1
  });

  const scheduler = new SchedulerService({});
  const mockTasks = [
    { id: 101, work_item_id: 1, name: 'Đào móng', duration: 5, earlyStart: 0, earlyFinish: 5 },
    { id: 102, work_item_id: 1, name: 'Đổ bê tông', duration: 5, earlyStart: 5, earlyFinish: 10, predecessors: [{ id: 101, type: 'FS', lag: 0 }] }
  ];

  // Check alert creation
  await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, mockTasks);

  const alertsWithChain = await scheduler.milestoneAlertService.getProjectAlertsWithChain(1, {
    status: 'active',
    scheduledTasks: mockTasks
  });

  assert.equal(alertsWithChain.length, 1, 'Trả đúng 1 cảnh báo đang mở');
  const alert = alertsWithChain[0];

  assert.equal(alert.milestoneId, 1);
  assert.equal(alert.milestoneTitle, 'Bàn giao móng');
  assert.equal(alert.dueDate, '2026-10-09');
  assert.equal(alert.actualEarlyFinish, 10);
  assert.ok(alert.overdueWorkdays > 0, 'Số ngày vượt phải lớn hơn 0');
});

test('T-45 TEST 3 & TEST 4: Chuỗi gây chậm truy ngược đúng A -> B -> C -> D và dùng TÊN công việc, không dùng ID', async () => {
  inMemoryMilestoneAlerts.length = 0;
  inMemoryMilestones.length = 0;
  inMemoryWorkItems.length = 0;

  inMemoryWorkItems.push({ id: 1, project_id: 1, parent_id: null, name: 'Hạng mục Kết cấu', code: 'HM-01' });

  createMilestoneData({
    work_item_id: 1,
    due_date: '2026-10-05',
    title: 'Mốc cất nóc',
    created_by: 1
  });

  const scheduler = new SchedulerService({});
  // Chuỗi A (1) -> B (2) -> C (3) -> D (4)
  const mockTasks = [
    { id: 1, work_item_id: 1, name: 'Công việc A', duration: 3, earlyStart: 0, earlyFinish: 3, predecessors: [] },
    { id: 2, work_item_id: 1, name: 'Công việc B', duration: 4, earlyStart: 3, earlyFinish: 7, predecessors: [{ id: 1, type: 'FS', lag: 0 }] },
    { id: 3, work_item_id: 1, name: 'Công việc C', duration: 5, earlyStart: 7, earlyFinish: 12, predecessors: [{ id: 2, type: 'FS', lag: 0 }] },
    { id: 4, work_item_id: 1, name: 'Công việc D', duration: 2, earlyStart: 12, earlyFinish: 14, predecessors: [{ id: 3, type: 'FS', lag: 0 }] }
  ];

  await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, mockTasks);

  const alerts = await scheduler.milestoneAlertService.getProjectAlertsWithChain(1, {
    status: 'active',
    scheduledTasks: mockTasks
  });

  assert.equal(alerts.length, 1);
  const chain = alerts[0].chain;

  assert.equal(chain.length, 4, 'Chuỗi phải đủ 4 công việc A, B, C, D');
  assert.equal(chain[0].name, 'Công việc A');
  assert.equal(chain[1].name, 'Công việc B');
  assert.equal(chain[2].name, 'Công việc C');
  assert.equal(chain[3].name, 'Công việc D');

  // Đảm bảo không phải hiển thị ID thay cho tên
  chain.forEach(item => {
    assert.ok(typeof item.name === 'string' && item.name.startsWith('Công việc'), 'Chuỗi phải sử dụng TÊN công việc');
  });
});

test('T-45 TEST 5: Milestone có nhiều dependency → chỉ lấy chuỗi thực sự quyết định Early Finish (loại bỏ non-driving)', async () => {
  inMemoryMilestoneAlerts.length = 0;
  inMemoryMilestones.length = 0;
  inMemoryWorkItems.length = 0;

  inMemoryWorkItems.push({ id: 1, project_id: 1, parent_id: null, name: 'Hạng mục Hạ tầng', code: 'HM-01' });

  createMilestoneData({
    work_item_id: 1,
    due_date: '2026-10-05',
    title: 'Mốc hạ tầng',
    created_by: 1
  });

  const scheduler = new SchedulerService({});
  // Task X (10) không quyết định ES của D vì Finish sớm (EF=3), Task C (3) finish trễ (EF=12) quyết định ES=12 cho D (4)
  const mockTasks = [
    { id: 10, work_item_id: 1, name: 'Công việc Phụ X', duration: 3, earlyStart: 0, earlyFinish: 3, predecessors: [] },
    { id: 1, work_item_id: 1, name: 'Công việc A', duration: 3, earlyStart: 0, earlyFinish: 3, predecessors: [] },
    { id: 2, work_item_id: 1, name: 'Công việc B', duration: 4, earlyStart: 3, earlyFinish: 7, predecessors: [{ id: 1, type: 'FS', lag: 0 }] },
    { id: 3, work_item_id: 1, name: 'Công việc C', duration: 5, earlyStart: 7, earlyFinish: 12, predecessors: [{ id: 2, type: 'FS', lag: 0 }] },
    { id: 4, work_item_id: 1, name: 'Công việc D', duration: 2, earlyStart: 12, earlyFinish: 14, predecessors: [{ id: 3, type: 'FS', lag: 0 }, { id: 10, type: 'FS', lag: 0 }] }
  ];

  await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, mockTasks);

  const alerts = await scheduler.milestoneAlertService.getProjectAlertsWithChain(1, {
    status: 'active',
    scheduledTasks: mockTasks
  });

  const chain = alerts[0].chain;
  const chainNames = chain.map(c => c.name);

  assert.deepEqual(chainNames, ['Công việc A', 'Công việc B', 'Công việc C', 'Công việc D']);
  assert.ok(!chainNames.includes('Công việc Phụ X'), 'Không chứa dependency không quyết định Early Finish');
});

test('T-45 TEST 6: Hạng mục có hạng mục con → truy được task thuộc hạng mục con gây chậm', async () => {
  inMemoryMilestoneAlerts.length = 0;
  inMemoryMilestones.length = 0;
  inMemoryWorkItems.length = 0;

  // Hạng mục cha 1 -> con 2 -> cháu 3
  inMemoryWorkItems.push({ id: 1, project_id: 1, parent_id: null, name: 'Hạng mục Cha', code: 'HM-01' });
  inMemoryWorkItems.push({ id: 2, project_id: 1, parent_id: 1, name: 'Hạng mục Con', code: 'HM-01.01' });
  inMemoryWorkItems.push({ id: 3, project_id: 1, parent_id: 2, name: 'Hạng mục Cháu', code: 'HM-01.01.01' });

  createMilestoneData({
    work_item_id: 1,
    due_date: '2026-10-05',
    title: 'Mốc tổng thể hạng mục cha',
    created_by: 1
  });

  const scheduler = new SchedulerService({});
  // Task ở hạng mục cháu 3 gây trễ mốc
  const mockTasks = [
    { id: 1, work_item_id: 1, name: 'Task ở Cha', duration: 2, earlyStart: 0, earlyFinish: 2, predecessors: [] },
    { id: 2, work_item_id: 3, name: 'Task ở Cháu Gây Chậm', duration: 10, earlyStart: 2, earlyFinish: 12, predecessors: [{ id: 1, type: 'FS', lag: 0 }] }
  ];

  await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, mockTasks);

  const alerts = await scheduler.milestoneAlertService.getProjectAlertsWithChain(1, {
    status: 'active',
    scheduledTasks: mockTasks
  });

  assert.equal(alerts.length, 1);
  const chain = alerts[0].chain;

  assert.equal(chain.length, 2);
  assert.equal(chain[1].name, 'Task ở Cháu Gây Chậm', 'Hạng mục con/cháu phải được truy đúng task gây chậm');
});

test('T-45 TEST 7: Milestone không còn vượt / alert đã đóng → không xuất hiện trong cảnh báo đang mở', async () => {
  inMemoryMilestoneAlerts.length = 0;
  inMemoryMilestones.length = 0;
  inMemoryWorkItems.length = 0;

  inMemoryWorkItems.push({ id: 1, project_id: 1, parent_id: null, name: 'Hạng mục 1', code: 'HM-01' });

  createMilestoneData({
    work_item_id: 1,
    due_date: '2026-10-10',
    title: 'Mốc tiến độ',
    created_by: 1
  });

  const scheduler = new SchedulerService({});
  
  // Lần 1: Trễ mốc -> alert active
  const lateTasks = [
    { id: 1, work_item_id: 1, name: 'Task A', duration: 15, earlyStart: 0, earlyFinish: 15 }
  ];
  await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, lateTasks);

  let activeAlerts = await scheduler.milestoneAlertService.getProjectAlertsWithChain(1, { status: 'active', scheduledTasks: lateTasks });
  assert.equal(activeAlerts.length, 1);

  // Lần 2: Đúng hạn -> alert closed
  const onTimeTasks = [
    { id: 1, work_item_id: 1, name: 'Task A', duration: 3, earlyStart: 0, earlyFinish: 3 }
  ];
  await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, onTimeTasks);

  activeAlerts = await scheduler.milestoneAlertService.getProjectAlertsWithChain(1, { status: 'active', scheduledTasks: onTimeTasks });
  assert.equal(activeAlerts.length, 0, 'Cảnh báo đã đóng không xuất hiện trong danh sách cảnh báo active');
});

test('T-45 TEST 8: Chạy API/service nhiều lần không tạo duplicate alert', async () => {
  inMemoryMilestoneAlerts.length = 0;
  inMemoryMilestones.length = 0;
  inMemoryWorkItems.length = 0;

  inMemoryWorkItems.push({ id: 1, project_id: 1, parent_id: null, name: 'Hạng mục 1', code: 'HM-01' });

  createMilestoneData({
    work_item_id: 1,
    due_date: '2026-10-05',
    title: 'Mốc lặp lại',
    created_by: 1
  });

  const scheduler = new SchedulerService({});
  const mockTasks = [
    { id: 1, work_item_id: 1, name: 'Task A', duration: 10, earlyStart: 0, earlyFinish: 10 }
  ];

  await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, mockTasks);
  await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, mockTasks);
  await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, mockTasks);

  const activeAlerts = await scheduler.milestoneAlertService.getProjectAlertsWithChain(1, { status: 'active', scheduledTasks: mockTasks });
  assert.equal(activeAlerts.length, 1, 'Chạy nhiều lần chỉ duy nhất 1 cảnh báo active (không duplicate)');
});

test('T-45 TEST 9: Nếu không có cảnh báo → trả danh sách rỗng, không lỗi', async () => {
  inMemoryMilestoneAlerts.length = 0;
  inMemoryMilestones.length = 0;
  inMemoryWorkItems.length = 0;

  const scheduler = new SchedulerService({});
  const alerts = await scheduler.milestoneAlertService.getProjectAlertsWithChain(1, { status: 'active' });

  assert.ok(Array.isArray(alerts), 'Trả về mảng');
  assert.equal(alerts.length, 0, 'Danh sách rỗng');
});
