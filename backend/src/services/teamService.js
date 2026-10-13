const store = require('../models/store');

class TeamService {
  constructor(db) {
    this.db = db;
    this.pool = db?.pool || db;
  }

  get isConnected() {
    return Boolean(this.db && this.db.isConnected !== false && this.pool);
  }

  /**
   * Lấy danh sách đội thi công của dự án kèm chỉ số tải trọng
   */
  async getProjectTeams(projectId) {
    const pId = Number(projectId);
    if (!this.isConnected) {
      return store.getTeams(pId);
    }

    try {
      // Truy vấn danh sách đội kèm thống kê công việc
      const query = `
        SELECT 
          pt.*,
          COUNT(t.id) AS task_count,
          SUM(CASE WHEN t.id IS NOT NULL AND t.status != 'completed' AND (t.percent_complete IS NULL OR t.percent_complete < 100) THEN 1 ELSE 0 END) AS active_task_count,
          SUM(CASE WHEN t.id IS NOT NULL AND (t.status = 'completed' OR t.percent_complete >= 100) THEN 1 ELSE 0 END) AS completed_task_count
        FROM project_teams pt
        LEFT JOIN tasks t ON pt.id = t.team_id AND t.project_id = pt.project_id
        WHERE pt.project_id = ?
        GROUP BY pt.id
        ORDER BY pt.id ASC
      `;
      const [rows] = await this.pool.query(query, [pId]);

      return rows.map(team => {
        const activeCount = Number(team.active_task_count || 0);
        const maxParallel = Number(team.max_parallel_tasks || 3);
        const isOverloaded = activeCount > maxParallel;
        const isFull = activeCount === maxParallel;

        let workloadStatus = 'normal';
        if (isOverloaded) {
          workloadStatus = 'overloaded';
        } else if (isFull) {
          workloadStatus = 'full';
        }

        return {
          ...team,
          task_count: Number(team.task_count || 0),
          active_task_count: activeCount,
          completed_task_count: Number(team.completed_task_count || 0),
          is_overloaded: isOverloaded,
          is_full: isFull,
          workload_ratio: Number((activeCount / maxParallel).toFixed(2)),
          workload_status: workloadStatus
        };
      });
    } catch (err) {
      return store.getTeams(pId);
    }
  }

  /**
   * Lấy chi tiết một đội thi công
   */
  async getTeamById(projectId, teamId) {
    const pId = Number(projectId);
    const tId = Number(teamId);

    if (!this.isConnected) {
      const team = store.getTeamById(tId);
      if (team && team.project_id === pId) return team;
      return null;
    }

    try {
      const [rows] = await this.pool.query(
        'SELECT * FROM project_teams WHERE id = ? AND project_id = ?',
        [tId, pId]
      );
      return rows[0] || null;
    } catch (err) {
      const team = store.getTeamById(tId);
      if (team && team.project_id === pId) return team;
      return null;
    }
  }

  /**
   * Tạo đội thi công mới
   */
  async createTeam(projectId, data) {
    const pId = Number(projectId);
    const name = String(data.name || '').trim();
    if (!name) {
      const err = new Error('Tên đội thi công không được để trống.');
      err.status = 400;
      throw err;
    }

    const maxParallel = Number(data.max_parallel_tasks || 3);
    if (!Number.isInteger(maxParallel) || maxParallel <= 0) {
      const err = new Error('Định mức công việc song song (max_parallel_tasks) phải là số nguyên dương.');
      err.status = 400;
      throw err;
    }

    if (!this.isConnected) {
      return store.createTeamData({ ...data, project_id: pId });
    }

    try {
      const code = data.code ? String(data.code).trim() : null;
      const leaderId = data.leader_id ? Number(data.leader_id) : null;
      const leaderName = data.leader_name ? String(data.leader_name).trim() : null;
      const phone = data.phone ? String(data.phone).trim() : null;
      const specialty = data.specialty ? String(data.specialty).trim() : 'Thi công xây dựng';
      const memberCount = Number(data.member_count || 10);
      const status = data.status || 'active';

      const insertQuery = `
        INSERT INTO project_teams (project_id, name, code, leader_id, leader_name, phone, specialty, member_count, max_parallel_tasks, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const [result] = await this.pool.query(insertQuery, [
        pId, name, code, leaderId, leaderName, phone, specialty, memberCount, maxParallel, status
      ]);

      return {
        id: result.insertId,
        project_id: pId,
        name,
        code: code || `DOI-${String(result.insertId).padStart(2, '0')}`,
        leader_id: leaderId,
        leader_name: leaderName,
        phone,
        specialty,
        member_count: memberCount,
        max_parallel_tasks: maxParallel,
        status
      };
    } catch (err) {
      return store.createTeamData({ ...data, project_id: pId });
    }
  }

  /**
   * Cập nhật thông tin đội thi công
   */
  async updateTeam(projectId, teamId, data) {
    const pId = Number(projectId);
    const tId = Number(teamId);

    if (!this.isConnected) {
      const updated = store.updateTeamData(tId, data);
      if (!updated) {
        const err = new Error('Không tìm thấy đội thi công cần cập nhật.');
        err.status = 404;
        throw err;
      }
      return updated;
    }

    try {
      const existing = await this.getTeamById(pId, tId);
      if (!existing) {
        const err = new Error('Không tìm thấy đội thi công cần cập nhật.');
        err.status = 404;
        throw err;
      }

      const updates = [];
      const params = [];

      if (data.name !== undefined) {
        updates.push('name = ?');
        params.push(String(data.name).trim());
      }
      if (data.code !== undefined) {
        updates.push('code = ?');
        params.push(String(data.code).trim());
      }
      if (data.leader_id !== undefined) {
        updates.push('leader_id = ?');
        params.push(data.leader_id ? Number(data.leader_id) : null);
      }
      if (data.leader_name !== undefined) {
        updates.push('leader_name = ?');
        params.push(String(data.leader_name).trim());
      }
      if (data.phone !== undefined) {
        updates.push('phone = ?');
        params.push(String(data.phone).trim());
      }
      if (data.specialty !== undefined) {
        updates.push('specialty = ?');
        params.push(String(data.specialty).trim());
      }
      if (data.member_count !== undefined) {
        updates.push('member_count = ?');
        params.push(Number(data.member_count));
      }
      if (data.max_parallel_tasks !== undefined) {
        updates.push('max_parallel_tasks = ?');
        params.push(Number(data.max_parallel_tasks));
      }
      if (data.status !== undefined) {
        updates.push('status = ?');
        params.push(data.status);
      }

      if (updates.length > 0) {
        params.push(tId, pId);
        await this.pool.query(
          `UPDATE project_teams SET ${updates.join(', ')} WHERE id = ? AND project_id = ?`,
          params
        );
      }

      return this.getTeamById(pId, tId);
    } catch (err) {
      if (err.status) throw err;
      return store.updateTeamData(tId, data);
    }
  }

  /**
   * Xóa đội thi công
   */
  async deleteTeam(projectId, teamId) {
    const pId = Number(projectId);
    const tId = Number(teamId);

    if (!this.isConnected) {
      const ok = store.deleteTeamData(tId);
      if (!ok) {
        const err = new Error('Không tìm thấy đội thi công để xóa.');
        err.status = 404;
        throw err;
      }
      return { success: true, message: 'Đã xóa đội thi công thành công.' };
    }

    try {
      const existing = await this.getTeamById(pId, tId);
      if (!existing) {
        const err = new Error('Không tìm thấy đội thi công để xóa.');
        err.status = 404;
        throw err;
      }

      // Xóa liên kết team trên các task
      await this.pool.query('UPDATE tasks SET team_id = NULL WHERE team_id = ? AND project_id = ?', [tId, pId]);
      await this.pool.query('DELETE FROM project_teams WHERE id = ? AND project_id = ?', [tId, pId]);

      return { success: true, message: 'Đã xóa đội thi công thành công.' };
    } catch (err) {
      if (err.status) throw err;
      store.deleteTeamData(tId);
      return { success: true, message: 'Đã xóa đội thi công thành công.' };
    }
  }

  /**
   * Chỉ huy trưởng giao việc cho đội thi công (Kèm tính toán cảnh báo quá tải)
   */
  async assignTaskToTeam({ projectId, taskId, teamId, assignedBy = 2, note = '' }) {
    const pId = Number(projectId);
    const tId = Number(taskId);
    const tmId = Number(teamId);

    if (!Number.isInteger(tmId) || tmId <= 0) {
      const err = new Error('teamId không hợp lệ.');
      err.status = 400;
      throw err;
    }

    if (!this.isConnected) {
      return store.assignTaskToTeamData({
        projectId: pId,
        taskId: tId,
        teamId: tmId,
        assignedBy,
        note
      });
    }

    try {
      // 1. Kiểm tra tồn tại task
      const [tasks] = await this.pool.query(
        'SELECT * FROM tasks WHERE id = ? AND project_id = ?',
        [tId, pId]
      );
      if (tasks.length === 0) {
        const err = new Error('Không tìm thấy công việc trong dự án.');
        err.status = 404;
        throw err;
      }
      const task = tasks[0];

      // 2. Kiểm tra tồn tại team
      const [teams] = await this.pool.query(
        'SELECT * FROM project_teams WHERE id = ? AND project_id = ?',
        [tmId, pId]
      );
      if (teams.length === 0) {
        const err = new Error('Không tìm thấy đội thi công trong dự án.');
        err.status = 404;
        throw err;
      }
      const team = teams[0];

      // 3. Đếm số task active hiện tại của team (không tính task này)
      const [countRows] = await this.pool.query(`
        SELECT COUNT(*) AS active_count 
        FROM tasks 
        WHERE project_id = ? AND team_id = ? AND id != ? AND status != 'completed' AND (percent_complete IS NULL OR percent_complete < 100)
      `, [pId, tmId, tId]);
      
      const currentActiveCount = Number(countRows[0]?.active_count || 0);
      const willBeActive = task.status !== 'completed' && Number(task.percent_complete || 0) < 100;
      const newActiveCount = currentActiveCount + (willBeActive ? 1 : 0);
      const maxParallel = Number(team.max_parallel_tasks || 3);
      const isOverloaded = newActiveCount > maxParallel;

      // 4. Cập nhật task
      const now = new Date();
      await this.pool.query(`
        UPDATE tasks 
        SET team_id = ?, assigned_by = ?, assigned_at = ?, assignment_note = ?
        WHERE id = ? AND project_id = ?
      `, [tmId, assignedBy, now, note ? String(note).trim() : null, tId, pId]);

      // 5. Ghi log vào task_assignments
      await this.pool.query(`
        INSERT INTO task_assignments (project_id, task_id, team_id, assigned_by, note, status)
        VALUES (?, ?, ?, ?, ?, 'assigned')
      `, [pId, tId, tmId, assignedBy, note ? String(note).trim() : null]);

      let warning = null;
      if (isOverloaded) {
        warning = `Cảnh báo quá tải: Đội "${team.name}" hiện đang phụ trách ${newActiveCount} công việc đang thi công (định mức tối đa là ${maxParallel} việc song song). Việc giao thêm công việc có thể dẫn đến chậm tiến độ!`;
      }

      return {
        success: true,
        task: {
          ...task,
          team_id: tmId,
          assigned_by: assignedBy,
          assigned_at: now.toISOString(),
          assignment_note: note
        },
        team,
        is_overloaded: isOverloaded,
        active_task_count: newActiveCount,
        max_parallel_tasks: maxParallel,
        warning
      };
    } catch (err) {
      if (err.status) throw err;
      return store.assignTaskToTeamData({
        projectId: pId,
        taskId: tId,
        teamId: tmId,
        assignedBy,
        note
      });
    }
  }

  /**
   * Hủy giao việc (gỡ đội thi công khỏi công việc)
   */
  async unassignTask({ projectId, taskId, assignedBy = 2 }) {
    const pId = Number(projectId);
    const tId = Number(taskId);

    if (!this.isConnected) {
      return store.unassignTaskData({ projectId: pId, taskId: tId, assignedBy });
    }

    try {
      const [tasks] = await this.pool.query(
        'SELECT * FROM tasks WHERE id = ? AND project_id = ?',
        [tId, pId]
      );
      if (tasks.length === 0) {
        const err = new Error('Không tìm thấy công việc trong dự án.');
        err.status = 404;
        throw err;
      }
      const task = tasks[0];
      const oldTeamId = task.team_id;

      await this.pool.query(`
        UPDATE tasks 
        SET team_id = NULL, assigned_by = NULL, assigned_at = NULL, assignment_note = NULL
        WHERE id = ? AND project_id = ?
      `, [tId, pId]);

      if (oldTeamId) {
        await this.pool.query(`
          INSERT INTO task_assignments (project_id, task_id, team_id, assigned_by, note, status)
          VALUES (?, ?, ?, ?, 'Hủy giao việc', 'unassigned')
        `, [pId, tId, oldTeamId, assignedBy]);
      }

      return {
        success: true,
        task: {
          ...task,
          team_id: null,
          assigned_by: null,
          assigned_at: null,
          assignment_note: null
        }
      };
    } catch (err) {
      if (err.status) throw err;
      return store.unassignTaskData({ projectId: pId, taskId: tId, assignedBy });
    }
  }

  /**
   * Báo cáo phân bổ tải trọng tổng thể các đội trong dự án (T-51)
   */
  async getTeamWorkloadSummary(projectId) {
    const teams = await this.getProjectTeams(projectId);
    const totalTeams = teams.length;
    const overloadedTeams = teams.filter(t => t.is_overloaded).length;
    const fullTeams = teams.filter(t => t.is_full).length;
    const normalTeams = teams.filter(t => t.workload_status === 'normal').length;

    let totalTasksAssigned = 0;
    let totalActiveTasks = 0;
    teams.forEach(t => {
      totalTasksAssigned += Number(t.task_count || 0);
      totalActiveTasks += Number(t.active_task_count || 0);
    });

    return {
      success: true,
      project_id: Number(projectId),
      total_teams: totalTeams,
      overloaded_teams_count: overloadedTeams,
      full_teams_count: fullTeams,
      normal_teams_count: normalTeams,
      total_tasks_assigned: totalTasksAssigned,
      total_active_tasks: totalActiveTasks,
      has_overload_alert: overloadedTeams > 0,
      teams
    };
  }
}

module.exports = TeamService;
