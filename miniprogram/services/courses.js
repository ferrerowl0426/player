const { request } = require('./request');

function buildQuery(params = {}) {
  const query = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${key}=${encodeURIComponent(params[key])}`)
    .join('&');
  return query ? `?${query}` : '';
}

function resolveCourseRequest(section) {
  const map = {
    'knowledge-set': { path: '/knowledge', type: 'knowledge_collection' },
    'track-set': { path: '/tracks', type: 'track_collection' },
    knowledge: { path: '/knowledge', type: 'knowledge_point' },
    track: { path: '/tracks', type: 'track_point' }
  };
  return map[section] || map.track;
}

function getCourses({ section, keyword, page = 1, pageSize = 20 } = {}) {
  const { path, type } = resolveCourseRequest(section);
  return request({ url: `${path}${buildQuery({ type, keyword, page, pageSize })}` });
}

function getTrackDetail(id) {
  return request({ url: `/tracks/${id}` });
}

function getTrackCollection(id) {
  return request({ url: `/tracks/collections/${id}` });
}

function getKnowledgeDetail(id) {
  return request({ url: `/knowledge/${id}` });
}

function getKnowledgeCollection(id) {
  return request({ url: `/knowledge/collections/${id}` });
}

module.exports = {
  getCourses,
  getTrackDetail,
  getTrackCollection,
  getKnowledgeDetail,
  getKnowledgeCollection
};
