const { getTrackDetail } = require('../../services/courses');
const { createVideoDetailPage } = require('../../utils/create-video-detail-page');

Page(createVideoDetailPage({
  loadDetailRequest: getTrackDetail,
  defaultTitle: '课程详情',
  loadErrorMessage: '课程详情加载失败'
}));
