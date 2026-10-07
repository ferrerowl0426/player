function buildUrl(path, params = {}) {
  const query = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${key}=${encodeURIComponent(params[key])}`)
    .join('&');
  return query ? `${path}?${query}` : path;
}

function navigateByAssignment(assignment = {}) {
  const target = assignment.target || {};
  const objectType = assignment.objectType || assignment.object_type || assignment.type || target.type || '';
  const objectId = assignment.objectId || assignment.object_id || assignment.id || target.id || '';
  const partId = assignment.partId || assignment.part_id || target.partId || '';

  const routeMap = {
    track_collection: '/pages/track-collection/index',
    track_point: '/pages/track-detail/index',
    track_part: '/pages/track-detail/index',
    knowledge_collection: '/pages/knowledge-collection/index',
    knowledge_point: '/pages/knowledge-detail/index',
    knowledge_part: '/pages/knowledge-detail/index'
  };

  const path = routeMap[objectType];

  if (!path || !objectId) {
    wx.showToast({ title: '内容暂不可打开', icon: 'none' });
    return;
  }

  wx.navigateTo({
    url: buildUrl(path, {
      id: objectId,
      part: objectType && objectType.endsWith('_part') ? partId || objectId : ''
    })
  });
}

module.exports = {
  buildUrl,
  navigateByAssignment
};
