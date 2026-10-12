const { getKnowledgeDetail } = require('../../services/courses');
const { createVideoDetailPage } = require('../../utils/create-video-detail-page');

Page(createVideoDetailPage({
  loadDetailRequest: getKnowledgeDetail,
  defaultTitle: '知识点详情',
  loadErrorMessage: '知识点详情加载失败'
}));
