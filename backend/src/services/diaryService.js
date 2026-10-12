const {
  getSiteDiaries,
  getSiteDiaryByDate,
  saveSiteDiaryEntry,
  lockSiteDiary,
  inMemoryTasks
} = require('../models/store');

const DAY_NAMES = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

function isValidDateString(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  return (
    dateObj.getUTCFullYear() === y &&
    (dateObj.getUTCMonth() + 1) === m &&
    dateObj.getUTCDate() === d
  );
}

function getMonday(dateInput) {
  const d = new Date(dateInput);
  const day = d.getDay();
  // Chủ Nhật (0) -> lùi 6 ngày về Thứ Hai tuần trước; Thứ 2 (1) -> lùi 0; Thứ 3 (2) -> lùi 1...
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const dayNum = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${dayNum}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dayNum = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dayNum}`;
}

class DiaryService {
  constructor(db) {
    this.db = db;
    this.pool = db?.pool || db;
  }

  validateEntry(data) {
    const errors = [];
    if (!data.diary_date || !isValidDateString(data.diary_date)) {
      errors.push('Ngày nhật ký không hợp lệ hoặc thiếu định dạng YYYY-MM-DD');
    }

    const allowedConditions = ['sunny', 'cloudy', 'rain_intermittent', 'rain_all_day'];
    if (data.weather_condition && !allowedConditions.includes(data.weather_condition)) {
      errors.push(`Điều kiện thời tiết không hợp lệ. Phải là một trong: ${allowedConditions.join(', ')}`);
    }

    if (data.manpower_count !== undefined && data.manpower_count !== null && data.manpower_count !== '') {
      const num = Number(data.manpower_count);
      if (!Number.isInteger(num) || num < 0) {
        errors.push('Số lượng nhân lực phải là số nguyên không âm (>= 0)');
      }
    }

    return errors;
  }

  async getDiaryByDate(projectId, dateStr) {
    const pId = Number(projectId);
    if (!isValidDateString(dateStr)) {
      throw new Error('Định dạng ngày không hợp lệ');
    }

    if (this.pool?.query) {
      const [rows] = await this.pool.query(
        'SELECT * FROM site_diaries WHERE project_id = ? AND diary_date = ? LIMIT 1',
        [pId, dateStr]
      );
      if (rows && rows.length > 0) {
        const item = rows[0];
        if (item.diary_date instanceof Date) {
          const y = item.diary_date.getFullYear();
          const m = String(item.diary_date.getMonth() + 1).padStart(2, '0');
          const d = String(item.diary_date.getDate()).padStart(2, '0');
          item.diary_date = `${y}-${m}-${d}`;
        }
        return item;
      }
      return null;
    }

    return getSiteDiaryByDate(pId, dateStr);
  }

  async getDiaries(projectId, { date, start_date, end_date, is_rain_day } = {}) {
    const pId = Number(projectId);

    if (this.pool?.query) {
      let query = 'SELECT * FROM site_diaries WHERE project_id = ?';
      const params = [pId];

      if (date) {
        query += ' AND diary_date = ?';
        params.push(date);
      }
      if (start_date && end_date) {
        query += ' AND diary_date >= ? AND diary_date <= ?';
        params.push(start_date, end_date);
      }
      if (is_rain_day !== undefined) {
        query += ' AND is_rain_day = ?';
        params.push(is_rain_day ? 1 : 0);
      }

      query += ' ORDER BY diary_date ASC';
      const [rows] = await this.pool.query(query, params);
      return (rows || []).map(r => {
        if (r.diary_date instanceof Date) {
          const y = r.diary_date.getFullYear();
          const m = String(r.diary_date.getMonth() + 1).padStart(2, '0');
          const d = String(r.diary_date.getDate()).padStart(2, '0');
          r.diary_date = `${y}-${m}-${d}`;
        }
        return r;
      });
    }

    return getSiteDiaries({
      project_id: pId,
      date,
      start_date,
      end_date,
      is_rain_day
    });
  }

  async saveDiary(projectId, entryData, userId = 1) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) {
      const err = new Error('projectId không hợp lệ');
      err.status = 400;
      throw err;
    }

    const validationErrors = this.validateEntry(entryData);
    if (validationErrors.length > 0) {
      const err = new Error(validationErrors.join('; '));
      err.status = 400;
      throw err;
    }

    const diaryDate = entryData.diary_date;
    const weatherCond = entryData.weather_condition || 'sunny';
    // Đánh dấu ngày mưa: nếu là rain_all_day hoặc truyền is_rain_day = true
    const isRain = (weatherCond === 'rain_all_day' || Boolean(entryData.is_rain_day)) ? 1 : 0;
    const manpower = Number(entryData.manpower_count || 0);
    const equipStatus = entryData.equipment_status ? String(entryData.equipment_status).trim() : '';
    const weatherNotes = entryData.weather_notes ? String(entryData.weather_notes).trim() : '';
    const workNotes = entryData.work_notes ? String(entryData.work_notes).trim() : '';
    const tempMin = entryData.temperature_min !== undefined && entryData.temperature_min !== null ? Number(entryData.temperature_min) : null;
    const tempMax = entryData.temperature_max !== undefined && entryData.temperature_max !== null ? Number(entryData.temperature_max) : null;

    if (this.pool?.query) {
      // 1. Kiểm tra khóa sổ trước khi lưu
      const [existingRows] = await this.pool.query(
        'SELECT id, is_locked FROM site_diaries WHERE project_id = ? AND diary_date = ? LIMIT 1',
        [pId, diaryDate]
      );

      if (existingRows && existingRows.length > 0 && existingRows[0].is_locked === 1) {
        const err = new Error('Nhật ký của ngày này đã bị khóa sổ, không thể chỉnh sửa.');
        err.status = 423;
        throw err;
      }

      // 2. Thực hiện UPSERT an toàn - Không tạo bản ghi trùng khi lưu nhiều lần
      await this.pool.query(
        `INSERT INTO site_diaries (
          project_id, diary_date, weather_condition, is_rain_day,
          temperature_min, temperature_max, weather_notes,
          manpower_count, equipment_status, work_notes, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          weather_condition = VALUES(weather_condition),
          is_rain_day = VALUES(is_rain_day),
          temperature_min = VALUES(temperature_min),
          temperature_max = VALUES(temperature_max),
          weather_notes = VALUES(weather_notes),
          manpower_count = VALUES(manpower_count),
          equipment_status = VALUES(equipment_status),
          work_notes = VALUES(work_notes),
          updated_at = CURRENT_TIMESTAMP`,
        [
          pId, diaryDate, weatherCond, isRain,
          tempMin, tempMax, weatherNotes,
          manpower, equipStatus, workNotes, userId
        ]
      );

      return this.getDiaryByDate(pId, diaryDate);
    }

    // In-memory fallback
    return saveSiteDiaryEntry({
      project_id: pId,
      diary_date: diaryDate,
      weather_condition: weatherCond,
      is_rain_day: Boolean(isRain),
      temperature_min: tempMin,
      temperature_max: tempMax,
      weather_notes: weatherNotes,
      manpower_count: manpower,
      equipment_status: equipStatus,
      work_notes: workNotes,
      created_by: userId
    });
  }

  /**
   * T51: Xem và đối chiếu dữ liệu tuần làm việc (Thứ Hai -> Thứ Sáu và mở rộng)
   */
  async getWeeklyComparison(projectId, targetDate) {
    const pId = Number(projectId);
    const baseDate = targetDate && isValidDateString(targetDate) ? targetDate : new Date().toISOString().split('T')[0];
    const mondayStr = getMonday(baseDate);

    // Lập danh sách 5 ngày làm việc chính thức (T2 -> T6) và 2 ngày cuối tuần (T7, CN)
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const dateStr = addDays(mondayStr, i);
      const dObj = new Date(dateStr + 'T00:00:00Z');
      const dayOfWeekIdx = dObj.getUTCDay(); // 0: CN, 1: T2, ..., 6: T7
      weekDays.push({
        date: dateStr,
        dayOfWeekIndex: dayOfWeekIdx,
        dayOfWeekName: DAY_NAMES[dayOfWeekIdx],
        isWorkday: dayOfWeekIdx >= 1 && dayOfWeekIdx <= 5, // Thứ 2 đến thứ 6
        isWeekend: dayOfWeekIdx === 0 || dayOfWeekIdx === 6
      });
    }

    const sundayStr = weekDays[6].date;
    const fridayStr = weekDays[4].date;

    // Lấy dữ liệu nhật ký của cả tuần
    const diaries = await this.getDiaries(pId, { start_date: mondayStr, end_date: sundayStr });
    const diaryMap = new Map();
    diaries.forEach(d => diaryMap.set(d.diary_date, d));

    let workdayRainCount = 0;
    const rainDates = [];

    const daysWithData = weekDays.map(wd => {
      const entry = diaryMap.get(wd.date) || null;
      const isRain = entry ? Boolean(entry.is_rain_day) : false;

      if (wd.isWorkday && isRain) {
        workdayRainCount++;
        rainDates.push(wd.date);
      }

      return {
        ...wd,
        hasDiary: Boolean(entry),
        diaryId: entry?.id || null,
        weatherCondition: entry?.weather_condition || 'none',
        weatherConditionText: entry ? (
          entry.weather_condition === 'rain_all_day' ? 'Mưa cả ngày' :
          entry.weather_condition === 'rain_intermittent' ? 'Mưa ngắt quãng' :
          entry.weather_condition === 'cloudy' ? 'Nhiều mây' : 'Nắng ráo'
        ) : 'Chưa có nhật ký',
        isRainDay: isRain,
        manpowerCount: entry?.manpower_count !== undefined ? entry.manpower_count : 0,
        equipmentStatus: entry?.equipment_status || '',
        weatherNotes: entry?.weather_notes || '',
        workNotes: entry?.work_notes || '',
        isLocked: Boolean(entry?.is_locked)
      };
    });

    // Lấy danh sách công việc của dự án để đối chiếu công việc có khả năng bị ảnh hưởng
    let activeTasks = [];
    try {
      if (this.pool?.query) {
        const [tRows] = await this.pool.query(
          'SELECT id, name, code, duration, status FROM tasks WHERE project_id = ? ORDER BY id ASC',
          [pId]
        );
        activeTasks = tRows || [];
      } else {
        activeTasks = (inMemoryTasks || []).filter(t => t.project_id === pId);
      }
    } catch (e) {
      // Bỏ qua lỗi query task nếu có
    }

    return {
      success: true,
      projectId: pId,
      weekRange: {
        startDate: mondayStr,
        fridayDate: fridayStr,
        endDate: sundayStr
      },
      summary: {
        totalWorkdays: 5,
        workdayRainCount,
        rainDates,
        rainRatio: Math.round((workdayRainCount / 5) * 100),
        statusAlert: workdayRainCount >= 3 ? 'high_risk' : (workdayRainCount > 0 ? 'medium_risk' : 'normal'),
        impactDescription: workdayRainCount === 0
          ? 'Thời tiết tuần làm việc thuận lợi, không có ngày mưa cản trở tiến độ.'
          : `Ghi nhận ${workdayRainCount}/5 ngày làm việc bị MƯA CẢ NGÀY (${rainDates.join(', ')}). Công trường cần đối chiếu nhật ký mưa với các công việc bị chậm tiến độ để lập biên bản gia hạn hoặc điều chỉnh kế hoạch thi công.`
      },
      days: daysWithData,
      tasksUnderReview: activeTasks.slice(0, 5).map(t => ({
        id: t.id,
        name: t.name,
        code: t.code,
        status: t.status,
        possibleDelayNote: workdayRainCount > 0 ? `Bị ảnh hưởng gián đoạn do ${workdayRainCount} ngày mưa trong tuần` : 'Đang thực hiện bình thường'
      }))
    };
  }
}

module.exports = { DiaryService, DAY_NAMES, getMonday, addDays, isValidDateString };
