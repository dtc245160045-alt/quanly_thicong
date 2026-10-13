const db = require('../db');

module.exports = async function checkDiaryLock(req, res, next) {
  try {
    const { id: projectId, date } = req.params;
    const entryDate = date || req.body.entry_date;

    if (!entryDate) {
      return next();
    }

    const [diary] = await db('site_diaries')
      .where({ project_id: projectId, diary_date: entryDate })
      .select('is_locked');

    if (diary && diary.is_locked) {
      return res.status(423).json({
        error: 'Locked',
        message: 'Nhat ky cua ngay nay da bi khoa so, khong the sua doi.'
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};
