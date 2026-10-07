const { request } = require('./request');

function getTodayHomework() {
  return request({ url: '/homework/today' });
}

function getHomeworkHistory({ page = 1, pageSize = 20 } = {}) {
  return request({ url: `/homework/history?page=${page}&pageSize=${pageSize}` });
}

module.exports = {
  getTodayHomework,
  getHomeworkHistory
};
