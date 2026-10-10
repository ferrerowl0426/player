const API_BASE_URL = 'https://api.nxhguitar.com/api/miniprogram';

const OBJECT_TYPE_LABELS = {
  track_collection: '合集',
  track_point: '单曲',
  track_part: 'P',
  knowledge_collection: '知识点集',
  knowledge_point: '知识',
  knowledge_part: 'P',
  library_pdf: 'PDF'
};

const OBJECT_TYPE_ACTIONS = {
  track_collection: '点击进入曲谱集详情',
  track_point: '点击播放默认 P1',
  track_part: '点击自动定位并播放分 P',
  knowledge_collection: '点击进入知识点集详情',
  knowledge_point: '点击播放默认 P1',
  knowledge_part: '点击自动定位并播放分 P'
};

module.exports = {
  API_BASE_URL,
  OBJECT_TYPE_LABELS,
  OBJECT_TYPE_ACTIONS
};
