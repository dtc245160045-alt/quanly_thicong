const { countWorkingDays } = require('../utils/workday');
const {
  inMemoryWorkItems,
  inMemoryMilestones,
  getMilestones,
  getMilestoneAlerts,
  saveMilestoneAlert,
  closeMilestoneAlert
} = require('../models/store');

class MilestoneAlertService {
  constructor(db) {
    this.pool = db?.pool || db;
  }

  /**
   * Recursive helper to gather a work item ID and all its descendant work item IDs.
   */
  getWorkItemSubtreeIds(rootWorkItemId, allWorkItems) {
    const ids = new Set([Number(rootWorkItemId)]);
    let added = true;
    while (added) {
      added = false;
      for (const item of allWorkItems) {
        if (item.parent_id && ids.has(Number(item.parent_id)) && !ids.has(Number(item.id))) {
          ids.add(Number(item.id));
          added = true;
        }
      }
    }
    return ids;
  }

  /**
   * Main T-44 logic: Check Early Finish of tasks against active milestones.
   * Runs in the same execution flow as T-36.
   *
   * @param {number} projectId 
   * @param {Array} scheduledTasks - Array of tasks output by SchedulerService with earlyFinish
   */
  async checkProjectMilestoneAlerts(projectId, scheduledTasks = []) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) return [];

    let milestones = [];
    let workItems = [];

    if (this.pool?.query) {
      try {
        const [mRows] = await this.pool.query(
          `SELECT m.*, w.project_id
           FROM milestones m
           JOIN work_items w ON m.work_item_id = w.id
           WHERE w.project_id = ? AND m.is_active = 1`,
          [pId]
        );
        milestones = mRows || [];

        const [wRows] = await this.pool.query(
          'SELECT id, project_id, parent_id, name, code FROM work_items WHERE project_id = ?',
          [pId]
        );
        workItems = wRows || [];
      } catch (err) {
        // Fallback to store if DB error occurs
        milestones = getMilestones({ is_active: 1 });
        workItems = inMemoryWorkItems.filter(w => w.project_id === pId);
      }
    } else {
      milestones = getMilestones({ is_active: 1 });
      workItems = inMemoryWorkItems.filter(w => w.project_id === pId);
    }

    if (!Array.isArray(milestones) || milestones.length === 0) {
      return [];
    }

    const processedAlerts = [];

    for (const milestone of milestones) {
      const subtreeIds = this.getWorkItemSubtreeIds(milestone.work_item_id, workItems);

      // Filter tasks belonging to the work item or any of its descendant work items
      const targetTasks = scheduledTasks.filter(task => {
        const wId = Number(task.work_item_id ?? task.workItemId);
        return subtreeIds.has(wId);
      });

      if (targetTasks.length === 0) {
        // No tasks under this work item tree, close any existing active alert
        await this.closeAlertForMilestone(pId, milestone.id);
        continue;
      }

      // 3. Find max Early Finish among these tasks (handling both numeric and date string earlyFinish)
      let maxEarlyFinish = null;
      for (const t of targetTasks) {
        const ef = t.earlyFinish ?? t.early_finish ?? t.early_end;
        if (ef === null || ef === undefined) continue;
        if (maxEarlyFinish === null) {
          maxEarlyFinish = ef;
        } else {
          const efVal = typeof ef === 'number' ? ef : (new Date(ef).getTime() || ef);
          const maxVal = typeof maxEarlyFinish === 'number' ? maxEarlyFinish : (new Date(maxEarlyFinish).getTime() || maxEarlyFinish);
          if (efVal > maxVal) {
            maxEarlyFinish = ef;
          }
        }
      }

      if (maxEarlyFinish === null) {
        await this.closeAlertForMilestone(pId, milestone.id);
        continue;
      }

      // 4 & 5. Compare max Early Finish with milestone due_date and calculate working days overrun
      const overdueDays = countWorkingDays(milestone.due_date, maxEarlyFinish);

      if (overdueDays > 0) {
        // 6 & 7. Record/update alert (prevents duplicate active alerts)
        const alertRecord = await this.upsertActiveAlert({
          project_id: pId,
          milestone_id: milestone.id,
          work_item_id: milestone.work_item_id,
          due_date: milestone.due_date,
          max_early_finish: maxEarlyFinish,
          overdue_days: overdueDays
        });
        processedAlerts.push(alertRecord);
      } else {
        // 8. If no longer overrun, close active alert and record closing timestamp
        await this.closeAlertForMilestone(pId, milestone.id);
      }
    }

    return processedAlerts;
  }

  async upsertActiveAlert(data) {
    if (this.pool?.query) {
      try {
        const [existing] = await this.pool.query(
          'SELECT id FROM milestone_alerts WHERE milestone_id = ? AND status = "active" LIMIT 1',
          [data.milestone_id]
        );

        if (existing && existing.length > 0) {
          const alertId = existing[0].id;
          await this.pool.query(
            `UPDATE milestone_alerts 
             SET due_date = ?, max_early_finish = ?, overdue_days = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [data.due_date, data.max_early_finish, data.overdue_days, alertId]
          );
          return { id: alertId, ...data, status: 'active' };
        } else {
          const [res] = await this.pool.query(
            `INSERT INTO milestone_alerts 
             (project_id, milestone_id, work_item_id, due_date, max_early_finish, overdue_days, status, opened_at)
             VALUES (?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)`,
            [data.project_id, data.milestone_id, data.work_item_id, data.due_date, data.max_early_finish, data.overdue_days]
          );
          return { id: res.insertId, ...data, status: 'active' };
        }
      } catch (err) {
        return saveMilestoneAlert(data);
      }
    } else {
      return saveMilestoneAlert(data);
    }
  }

  async closeAlertForMilestone(projectId, milestoneId) {
    if (this.pool?.query) {
      try {
        await this.pool.query(
          `UPDATE milestone_alerts 
           SET status = 'closed', closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE milestone_id = ? AND status = 'active'`,
          [milestoneId]
        );
      } catch (err) {
        closeMilestoneAlert(milestoneId);
      }
    } else {
      closeMilestoneAlert(milestoneId);
    }
  }

  /**
   * Helper to build driving chain for a milestone from computed scheduledTasks.
   */
  buildDrivingChain(milestoneWorkItemId, scheduledTasks = [], workItems = [], dependencies = []) {
    if (!Array.isArray(scheduledTasks) || scheduledTasks.length === 0) {
      return [];
    }

    const subtreeIds = this.getWorkItemSubtreeIds(milestoneWorkItemId, workItems);

    // 1. Filter tasks belonging to the work item or any of its descendant work items
    const targetTasks = scheduledTasks.filter(task => {
      const wId = Number(task.work_item_id ?? task.workItemId);
      return subtreeIds.has(wId);
    });

    if (targetTasks.length === 0) {
      return [];
    }

    // Find task with max Early Finish causing delay
    let lastTask = null;
    let maxEFVal = -Infinity;

    for (const t of targetTasks) {
      const ef = t.earlyFinish ?? t.early_finish ?? t.early_end;
      if (ef === null || ef === undefined) continue;
      const val = typeof ef === 'number' ? ef : (new Date(ef).getTime() || 0);
      if (val > maxEFVal) {
        maxEFVal = val;
        lastTask = t;
      }
    }

    if (!lastTask) {
      return [];
    }

    // Map all scheduled tasks by normalized ID and populate predecessors
    const taskMap = new Map();
    for (const t of scheduledTasks) {
      const idStr = String(t.id ?? t.taskId ?? t.task_id);
      taskMap.set(idStr, { ...t, predecessors: Array.isArray(t.predecessors) ? [...t.predecessors] : [] });
    }

    // Populate predecessors if dependencies array is provided
    if (Array.isArray(dependencies) && dependencies.length > 0) {
      for (const dep of dependencies) {
        const pId = String(dep.predecessorId ?? dep.predecessor_task_id);
        const sId = String(dep.successorId ?? dep.successor_task_id);
        const type = String(dep.type ?? dep.dependency_type ?? 'FS').toUpperCase();
        const lag = Number(dep.lag ?? dep.lag_days ?? 0);
        if (taskMap.has(sId)) {
          const succ = taskMap.get(sId);
          if (!succ.predecessors.some(p => String(typeof p === 'object' ? (p.id ?? p.predecessorId) : p) === pId)) {
            succ.predecessors.push({ id: pId, predecessorId: pId, type, lag });
          }
        }
      }
    }

    // Helper to calculate relation weight
    const calculateWeight = (predTask, succTask, type = 'FS', lag = 0) => {
      const durationP = Number(predTask.duration || 0);
      const durationS = Number(succTask.duration || 0);
      const normType = String(type).toUpperCase();
      const normLag = Number(lag || 0);
      const weights = {
        FS: durationP + normLag,
        SS: normLag,
        FF: durationP + normLag - durationS,
        SF: normLag - durationS
      };
      return weights[normType] !== undefined ? weights[normType] : durationP + normLag;
    };

    // Backtrack from lastTask along driving dependencies
    const chainPath = [];
    let curr = lastTask;
    const visited = new Set();

    while (curr && !visited.has(String(curr.id ?? curr.taskId))) {
      const currId = String(curr.id ?? curr.taskId);
      visited.add(currId);
      chainPath.push(curr);

      const predecessors = curr.predecessors || [];
      if (predecessors.length === 0) {
        break;
      }

      let drivingPred = null;
      for (const predRef of predecessors) {
        const predId = String(typeof predRef === 'object' ? (predRef.id ?? predRef.predecessorId) : predRef);
        const predTask = taskMap.get(predId);
        if (!predTask) continue;

        const type = typeof predRef === 'object' ? (predRef.type ?? 'FS') : 'FS';
        const lag = typeof predRef === 'object' ? (predRef.lag ?? 0) : 0;
        const weight = calculateWeight(predTask, curr, type, lag);

        if (typeof curr.earlyStart === 'number' && typeof predTask.earlyStart === 'number') {
          if (Math.abs(curr.earlyStart - (predTask.earlyStart + weight)) < 1e-4) {
            drivingPred = predTask;
            break;
          }
        } else {
          drivingPred = predTask;
          break;
        }
      }

      if (drivingPred) {
        curr = drivingPred;
      } else {
        break;
      }
    }

    // Reverse to get chronological order from root cause to final task
    chainPath.reverse();

    return chainPath.map(t => ({
      id: t.id ?? t.taskId,
      name: t.name || `Công việc ${t.id ?? t.taskId}`,
      code: t.code || null,
      earlyStart: t.earlyStart,
      earlyFinish: t.earlyFinish,
      duration: t.duration
    }));
  }

  async getProjectAlerts(projectId, { status } = {}) {
    const pId = Number(projectId);
    if (this.pool?.query) {
      try {
        let sql = 'SELECT * FROM milestone_alerts WHERE project_id = ?';
        const params = [pId];
        if (status) {
          sql += ' AND status = ?';
          params.push(status);
        }
        sql += ' ORDER BY id DESC';
        const [rows] = await this.pool.query(sql, params);
        return rows || [];
      } catch (err) {
        return getMilestoneAlerts({ project_id: pId, status });
      }
    } else {
      return getMilestoneAlerts({ project_id: pId, status });
    }
  }

  async getProjectAlertsWithChain(projectId, { status = 'active', scheduledTasks = null, dependencies = null } = {}) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) return [];

    const alerts = await this.getProjectAlerts(pId, status && status !== 'all' ? { status } : {});
    if (!Array.isArray(alerts) || alerts.length === 0) {
      return [];
    }

    let milestones = [];
    let workItems = [];
    let deps = dependencies || [];

    if (this.pool?.query) {
      try {
        const [mRows] = await this.pool.query(
          `SELECT m.*, w.name as work_item_name, w.code as work_item_code
           FROM milestones m
           LEFT JOIN work_items w ON m.work_item_id = w.id
           WHERE w.project_id = ?`,
          [pId]
        );
        milestones = mRows || [];

        const [wRows] = await this.pool.query(
          'SELECT id, project_id, parent_id, name, code FROM work_items WHERE project_id = ?',
          [pId]
        );
        workItems = wRows || [];

        if (!dependencies) {
          const [dRows] = await this.pool.query(
            'SELECT predecessor_task_id as predecessorId, successor_task_id as successorId, dependency_type as type, lag_days as lag FROM task_dependencies WHERE project_id = ?',
            [pId]
          );
          deps = dRows || [];
        }
      } catch (err) {
        milestones = getMilestones();
        workItems = inMemoryWorkItems.filter(w => Number(w.project_id) === pId);
      }
    } else {
      milestones = getMilestones();
      workItems = inMemoryWorkItems.filter(w => Number(w.project_id) === pId);
    }

    const milestoneMap = new Map(milestones.map(m => [Number(m.id), m]));

    if (!scheduledTasks) {
      try {
        const { SchedulerService } = require('../domain/scheduling/schedulerService');
        const scheduler = new SchedulerService(this.pool);
        const schedRes = await scheduler.getProjectSchedule(pId, deps.length > 0 ? deps : null);
        scheduledTasks = schedRes.tasks || [];
      } catch (err) {
        scheduledTasks = [];
      }
    }

    const result = [];
    for (const alert of alerts) {
      const milestone = milestoneMap.get(Number(alert.milestone_id));
      const workItem = workItems.find(w => Number(w.id) === Number(alert.work_item_id));

      const milestoneTitle = alert.milestone_title || alert.milestoneTitle || milestone?.title || milestone?.work_item_name || workItem?.name || `Mốc #${alert.milestone_id}`;
      const chain = this.buildDrivingChain(alert.work_item_id, scheduledTasks, workItems, deps);

      result.push({
        id: alert.id,
        projectId: pId,
        project_id: pId,
        milestoneId: alert.milestone_id,
        milestone_id: alert.milestone_id,
        workItemId: alert.work_item_id,
        work_item_id: alert.work_item_id,
        milestoneTitle,
        milestone_title: milestoneTitle,
        dueDate: alert.due_date,
        due_date: alert.due_date,
        actualEarlyFinish: alert.max_early_finish,
        max_early_finish: alert.max_early_finish,
        overdueWorkdays: alert.overdue_days,
        overdue_days: alert.overdue_days,
        status: alert.status,
        openedAt: alert.opened_at,
        opened_at: alert.opened_at,
        closedAt: alert.closed_at,
        closed_at: alert.closed_at,
        chain
      });
    }

    return result;
  }
}

module.exports = { MilestoneAlertService };

