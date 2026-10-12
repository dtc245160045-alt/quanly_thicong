const express = require('express');
const { checkViewerForbidden, checkProjectReadAccess } = require('../utils/rbac');
const { DiaryService } = require('../services/diaryService');

module.exports = (db) => {
  const router = express.Router();
  const diaryService = new DiaryService(db);

  // 1. Xem đối chiếu tuần làm việc và thống kê ngày mưa (T51)
  // Lưu ý: Đặt route /week-comparison trước route /:date để tránh trùng khớp tham số
  router.get('/projects/:projectId/diaries/week-comparison', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }

    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const targetDate = req.query.date || req.query.target_date || new Date().toISOString().split('T')[0];
      const result = await diaryService.getWeeklyComparison(projectId, targetDate);
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Lỗi khi lấy dữ liệu đối chiếu tuần'
      });
    }
  });

  // 2. Lấy danh sách nhật ký theo dự án (hỗ trợ lọc ngày, khoảng ngày, ngày mưa)
  router.get('/projects/:projectId/diaries', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }

    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const { date, start_date, end_date, is_rain_day } = req.query;
      const isRain = is_rain_day !== undefined ? (is_rain_day === 'true' || is_rain_day === '1') : undefined;

      const data = await diaryService.getDiaries(projectId, {
        date,
        start_date,
        end_date,
        is_rain_day: isRain
      });

      res.json({ success: true, data });
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Lỗi khi truy vấn danh sách nhật ký'
      });
    }
  });

  // 3. Lấy chi tiết nhật ký của một ngày cụ thể
  router.get('/projects/:projectId/diaries/:date', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const dateStr = req.params.date;

    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }

    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const data = await diaryService.getDiaryByDate(projectId, dateStr);
      if (!data) {
        return res.status(404).json({
          success: false,
          message: `Chưa có dữ liệu nhật ký cho ngày ${dateStr}`,
          data: null
        });
      }
      res.json({ success: true, data });
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Lỗi khi lấy chi tiết nhật ký ngày'
      });
    }
  });

  // 4. Lưu / Cập nhật nhật ký ngày (Form T51 - hỗ trợ đánh dấu ngày mưa, thiết bị, nhân lực)
  router.post('/projects/:projectId/diaries', async (req, res) => {
    const projectId = Number(req.params.projectId || req.body.project_id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }

    // RBAC: Chặn Viewer sửa/lưu dữ liệu
    if (checkViewerForbidden(req, res)) return;

    try {
      const userId = req.user?.userId || req.user?.id || 1;
      const saved = await diaryService.saveDiary(projectId, req.body, userId);
      res.status(200).json({
        success: true,
        message: 'Lưu thông tin nhật ký ngày thành công',
        data: saved
      });
    } catch (err) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({
        success: false,
        message: err.message || 'Không thể lưu nhật ký công trường'
      });
    }
  });

  return router;
};
