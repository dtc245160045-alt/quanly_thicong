const { TaskDependencyGraph } = require('./graph');
const { topologicalSort } = require('./topologicalSort');
const { validateDependencyContract } = require('./contracts');
const { calculateForwardPass } = require('../../algorithms/forwardPass');
const { calculateBackwardPass, normalizeId } = require('../../algorithms/backwardPass');
const { ScheduleResultRepository } = require('../../repositories/scheduleResultRepository');
const { BaselineRepository } = require('../../repositories/baselineRepository');
const { MilestoneAlertService } = require('../../services/milestoneAlertService');

class SchedulerService {
  constructor(db) {
    this.db = db;
    this.pool = db?.pool || db;
    this.resultRepo = new ScheduleResultRepository(db);
    this.baselineRepo = new BaselineRepository(db);
    this.milestoneAlertService = new MilestoneAlertService(db);
  }

  computeSchedule(tasks = [], dependencies = []) {
    if (!Array.isArray(tasks) || !Array.isArray(dependencies)) {
      throw new Error('tasks và dependencies phải là mảng');
    }

    const normalizedTasks = tasks.map(task => {
      const id = normalizeId(task?.id, 'task.id');
      const duration = Number(task?.duration);
      if (!Number.isFinite(duration) || duration < 0) {
        throw new Error(`duration của task ${id} phải là số không âm hữu hạn`);
      }
      return { ...task, normalizedId: id, duration, predecessors: [] };
    });

    const normalizedDependencies = dependencies.map((dependency, index) => {
      const candidate = {
        predecessorId: dependency?.predecessorId,
        successorId: dependency?.successorId,
        type: dependency?.type,
        lag: dependency?.lag
      };
      const validation = validateDependencyContract(candidate);
      if (!validation.valid && !validation.error?.includes('Self-loop')) {
        throw new Error(`Dependency ${index + 1}: ${validation.error}`);
      }
      return {
        predecessorId: normalizeId(candidate.predecessorId, `dependency[${index}].predecessorId`),
        successorId: normalizeId(candidate.successorId, `dependency[${index}].successorId`),
        type: String(candidate.type ?? 'FS').toUpperCase(),
        lag: Number(candidate.lag ?? 0)
      };
    });

    const taskById = new Map(normalizedTasks.map(task => [task.normalizedId, task]));
    for (const dependency of normalizedDependencies) {
      if (!taskById.has(dependency.predecessorId) || !taskById.has(dependency.successorId)) {
        throw new Error(`Dependency tham chiếu task không tồn tại: ${dependency.predecessorId} -> ${dependency.successorId}`);
      }
      taskById.get(dependency.successorId).predecessors.push({
        id: dependency.predecessorId,
        type: dependency.type,
        lag: dependency.lag
      });
    }

    const graph = new TaskDependencyGraph().setNodes(normalizedTasks).setEdges(normalizedDependencies);
    const topology = topologicalSort(graph);
    if (topology.hasCycle) {
      return { ...topology, nodeCount: graph.getNodeCount(), edgeCount: graph.getEdgeCount(), projectDuration: null, tasks: [] };
    }
    if (normalizedTasks.length === 0) {
      return { ...topology, nodeCount: 0, edgeCount: 0, projectDuration: 0, tasks: [] };
    }

    const earlySchedule = calculateForwardPass(normalizedTasks, topology.orderedIds, 0);
    const schedule = calculateBackwardPass(normalizedTasks, topology.orderedIds, earlySchedule, normalizedDependencies);
    const sourceById = new Map(tasks.map(task => [normalizeId(task.id, 'task.id'), task]));
    const scheduledTasks = schedule.map(item => {
      const idNorm = normalizeId(item.taskId, 'taskId');
      const source = sourceById.get(idNorm);
      const normTask = taskById.get(idNorm);
      const taskObj = {
        ...item,
        name: source?.name,
        code: source?.code,
        status: source?.status
      };
      if (source?.actual_start !== undefined) taskObj.actual_start = source.actual_start;
      if (source?.actual_end !== undefined) taskObj.actual_end = source.actual_end;
      if (source?.percent_complete !== undefined) taskObj.percent_complete = Number(source.percent_complete);
      const wId = source?.work_item_id ?? source?.workItemId;
      if (wId !== undefined) {
        taskObj.work_item_id = wId;
      }
      const preds = normTask?.predecessors || source?.predecessors;
      if (preds && preds.length > 0) {
        taskObj.predecessors = preds;
      }
      return taskObj;
    });
    const projectDuration = Math.max(...scheduledTasks.map(task => task.earlyFinish));

    return {
      ...topology,
      nodeCount: graph.getNodeCount(),
      edgeCount: graph.getEdgeCount(),
      projectDuration,
      tasks: scheduledTasks
    };
  }

  async getProjectSchedule(projectId, mockDependencies = null) {
    let tasks = [];
    let dependencies = [];
    let integrationStatus = 'INTEGRATED WITH S-06';

    if (this.pool && typeof this.pool.query === 'function' && this.db?.isConnected !== false) {
      const [tRows] = await this.pool.query(
        'SELECT id, project_id, work_item_id, name, code, duration, status FROM tasks WHERE project_id = ? ORDER BY id ASC',
        [projectId]
      );
      tasks = tRows || [];

      if (Array.isArray(mockDependencies)) {
        dependencies = mockDependencies;
        integrationStatus = 'USING_MOCK_DEPENDENCIES';
      } else {
        const [dRows] = await this.pool.query(
          'SELECT id, project_id, predecessor_task_id, successor_task_id, dependency_type, lag_days FROM task_dependencies WHERE project_id = ? ORDER BY id ASC',
          [projectId]
        );
        dependencies = (dRows || []).map(row => ({
          predecessorId: row.predecessor_task_id,
          successorId: row.successor_task_id,
          type: row.dependency_type,
          lag: Number(row.lag_days)
        }));
      }
    } else {
      const { inMemoryTasks, inMemoryDependencies } = require('../../models/store');
      tasks = inMemoryTasks.filter(t => t.project_id === Number(projectId));
      dependencies = (inMemoryDependencies || []).filter(d => d.project_id === Number(projectId)).map(d => ({
        predecessorId: d.predecessor_task_id,
        successorId: d.successor_task_id,
        type: d.dependency_type,
        lag: Number(d.lag_days || 0)
      }));
    }

    const computed = this.computeSchedule(tasks, dependencies);

    if (Array.isArray(computed.tasks) && computed.tasks.length > 0) {
      try {
        await this.milestoneAlertService.checkProjectMilestoneAlerts(projectId, computed.tasks);
      } catch (err) {
        // Safe fallback if milestone alert check fails
      }
    }

    return {
      projectId,
      integrationStatus,
      dependenciesCount: dependencies.length,
      ...computed
    };
  }

  async invalidateProjectSchedule(projectId) {
    return this.resultRepo.markStale(projectId);
  }

  async getProjectScheduleResults(projectId, { criticalOnly = false, forceRecalculate = false } = {}) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) {
      throw new Error('projectId không hợp lệ');
    }

    const isStale = forceRecalculate || (await this.resultRepo.isStale(pId));
    if (!isStale) {
      const saved = await this.resultRepo.getSavedResults(pId, { criticalOnly });
      if (!saved.error && (saved.totalTasks > 0 || (saved.tasks && saved.tasks.length === 0 && saved.totalTasks === 0))) {
        return {
          success: true,
          projectId: pId,
          isCached: true,
          projectDuration: saved.projectDuration,
          totalTasks: saved.totalTasks,
          criticalTasksCount: saved.criticalTasksCount,
          calculatedAt: saved.calculatedAt,
          tasks: saved.tasks
        };
      }
    }

    // Nếu stale hoặc chưa có kết quả lưu, tiến hành tính toán
    const schedule = await this.getProjectSchedule(pId);
    if (schedule.hasCycle) {
      // Transaction rollback: Không lưu bảng kết quả dở dang khi có cycle (T-26)
      return {
        success: false,
        projectId: pId,
        hasCycle: true,
        cyclePath: schedule.cyclePath,
        cycleNodes: schedule.cycleNodes,
        message: `Phát hiện chu trình vòng lặp phụ thuộc (circular dependency): ${schedule.cyclePath}`
      };
    }

    // Lưu toàn bộ kết quả vào schedule_results trong một database transaction duy nhất (T-26)
    await this.resultRepo.saveResultsInTransaction(pId, schedule.tasks, schedule.projectDuration);

    // T-44: Kiểm tra và lưu/đóng cảnh báo milestone trong cùng tác vụ T-36
    try {
      await this.milestoneAlertService.checkProjectMilestoneAlerts(pId, schedule.tasks);
    } catch (err) {}

    const sortedTasks = [...schedule.tasks].sort((a, b) => {
      if (a.earlyStart !== b.earlyStart) return a.earlyStart - b.earlyStart;
      return String(a.taskId ?? a.id).localeCompare(String(b.taskId ?? b.id));
    });

    const filteredTasks = criticalOnly ? sortedTasks.filter(t => t.isCritical) : sortedTasks;
    const criticalCount = sortedTasks.filter(t => t.isCritical).length;

    let actualMap = new Map();
    try {
      if (this.pool?.query) {
        const [taskRows] = await this.pool.query('SELECT id, actual_start, actual_end, percent_complete, status FROM tasks WHERE project_id = ?', [pId]);
        if (Array.isArray(taskRows)) {
          for (const row of taskRows) {
            actualMap.set(row.id, row);
          }
        }
      }
    } catch {}

    return {
      success: true,
      projectId: pId,
      isCached: false,
      projectDuration: schedule.projectDuration,
      totalTasks: sortedTasks.length,
      criticalTasksCount: criticalCount,
      calculatedAt: new Date().toISOString(),
      tasks: filteredTasks.map(t => {
        const act = actualMap.get(t.taskId ?? t.id);
        const tId = Number(t.taskId ?? t.id);
        return {
          id: tId,
          taskId: tId,
          name: t.name,
          code: t.code,
          duration: Number(t.duration),
          actualStart: act?.actual_start ? String(act.actual_start).split('T')[0] : (t.actualStart ?? null),
          actualEnd: act?.actual_end ? String(act.actual_end).split('T')[0] : (t.actualEnd ?? null),
          percentComplete: act?.percent_complete !== undefined && act?.percent_complete !== null ? Number(act.percent_complete) : Number(t.percentComplete ?? 0),
          status: act?.status || t.status,
          earlyStart: Number(t.earlyStart),
          earlyFinish: Number(t.earlyFinish),
          lateStart: Number(t.lateStart),
          lateFinish: Number(t.lateFinish),
          totalFloat: Number(t.totalFloat),
          isCritical: Boolean(t.isCritical)
        };
      })
    };
  }

  /**
   * S-18 / SCRUM-91: Lấy kế hoạch gốc hiện hành của dự án (AC 2 & AC 4)
   */
  async getProjectBaseline(projectId) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) {
      throw new Error('projectId không hợp lệ');
    }
    return this.baselineRepo.getCurrentBaseline(pId);
  }

  /**
   * S-18 / SCRUM-91: Chốt kế hoạch gốc (AC 1 & AC 3)
   * Lấy kết quả tính toán tiến độ hiện tại để lưu thành baseline độc lập
   */
  async lockProjectBaseline(projectId, { userId = null, userName = 'Ban Quản Lý', reason = null } = {}) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) {
      throw new Error('projectId không hợp lệ');
    }

    // Đảm bảo tiến độ đã được tính toán đầy đủ
    const scheduleResults = await this.getProjectScheduleResults(pId, { forceRecalculate: false });
    if (scheduleResults.hasCycle) {
      throw new Error('Không thể chốt kế hoạch gốc vì dự án đang có vòng lặp phụ thuộc (chu trình)');
    }
    if (!scheduleResults.tasks || scheduleResults.tasks.length === 0) {
      throw new Error('Dự án chưa có công việc nào để chốt kế hoạch gốc');
    }

    return this.baselineRepo.lockBaseline(pId, {
      tasks: scheduleResults.tasks,
      projectDuration: scheduleResults.projectDuration,
      userId,
      userName,
      reason
    });
  }

  /**
   * S-18 / SCRUM-91: Lấy lịch sử các lần chốt kế hoạch gốc (AC 3)
   */
  async getProjectBaselineHistory(projectId) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) {
      throw new Error('projectId không hợp lệ');
    }
    return this.baselineRepo.getHistory(pId);
  }
}

module.exports = { SchedulerService };

