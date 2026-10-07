const { OBJECT_TYPE_LABELS, OBJECT_TYPE_ACTIONS } = require('./constants');

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDateText(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function formatTimeText(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatWeekText(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
}

function normalizeAssignment(item = {}) {
  const target = item.target || {};
  const objectType = item.objectType || item.object_type || item.type || target.type || '';
  const objectId = item.objectId || item.object_id || (target.id !== undefined ? target.id : '') || '';
  const partId = item.partId || item.part_id || (target.partId !== undefined ? target.partId : '') || '';
  const partNo = item.partNo || item.part_no || item.no || item.partIndex || item.part_index || '';
  const typeLabel = OBJECT_TYPE_LABELS[objectType] || '内容';
  const partLabel = partNo ? `P${String(partNo).padStart(2, '0')}` : '';
  return {
    ...item,
    id: item.id,
    objectType,
    objectId,
    partId,
    partNo,
    title: item.title || item.assignedObjectTitle || item.assigned_object_title || '未命名内容',
    coverUrl: item.coverUrl || item.cover_url || '',
    typeLabel,
    actionText: OBJECT_TYPE_ACTIONS[objectType] || '点击查看详情',
    partLabel,
    materialMeta: item.materialMeta || item.material_meta || (partLabel ? `${typeLabel} · 自动定位到 ${partLabel}` : `${typeLabel} · 查看收录内容`),
    materialAction: item.materialAction || item.material_action || (objectType === 'track_part' || objectType === 'knowledge_part' ? '进入详情并播放' : '进入详情')
  };
}

function normalizeHomeworkGroup(data) {
  const payload = data || {};
  const source = payload.latestHomework || payload.homework || payload;
  const assignments = (source.assignments || source.items || []).map(normalizeAssignment);
  const first = assignments[0] || {};
  const assignmentTime = source.assignmentDate || source.assignment_date || source.createdAt || source.created_at;
  return {
    operationId: source.operationId || source.operation_id || '',
    assignmentDate: assignmentTime,
    assignmentDateText: formatDateText(assignmentTime),
    assignmentTimeText: formatTimeText(assignmentTime),
    teacherName: source.teacherName || source.teacher_name || first.teacherName || first.teacher_name || '老师',
    statusText: assignments.length > 0 ? '今日作业已更新' : '等待老师布置作业',
    assignments,
    practiceRequirement: source.practiceRequirement || source.practice_requirement || first.practiceRequirement || first.practice_requirement || '',
    submitRequirement: source.submitRequirement || source.submit_requirement || first.submitRequirement || first.submit_requirement || ''
  };
}

function normalizeCourseItems(data, section, keyword = '') {
  const rawItems = Array.isArray(data) ? data : [...(data?.points || data?.items || []), ...(data?.collections || [])];
  const q = String(keyword || '').trim().toLowerCase();
  return rawItems
    .filter((item) => !q || String(item.title || item.name || '').toLowerCase().includes(q))
    .map((item, index) => {
      const typeMap = {
        'knowledge-set': { label: '知识点集', base: '/pages/knowledge-collection/index', isSet: true, theme: 'theme-k', tagClass: 'k' },
        'track-set': { label: '曲目集', base: '/pages/track-collection/index', isSet: true, theme: 'theme-s', tagClass: 'set' },
        knowledge: { label: '知识点', base: '/pages/knowledge-detail/index', isSet: false, theme: 'theme-k', tagClass: 'k' },
        track: { label: '曲目', base: '/pages/track-detail/index', isSet: false, theme: '', tagClass: '' }
      };
      const conf = typeMap[section] || typeMap.track;
      const title = item.title || item.name || '未命名课程';
      const countLabel = item.countLabel || item.count_label || (conf.isSet ? `${(index % 4) + 5} 项` : `P${(index % 4) + 1}`);
      const contentCount = item.contentCount || item.content_count || item.count || item.total || Number.parseInt(countLabel, 10) || ((index % 4) + 5);
      const updateDateText = item.updateDateText || item.update_date_text || item.updatedAtText || item.updated_at_text || formatDateText(item.updatedAt || item.updated_at || item.createdAt || item.created_at) || `更新于 10 月 ${7 - (index % 5)} 日`;
      return {
        ...item,
        key: `${section}-${item.id || index}`,
        title,
        coverUrl: item.coverUrl || item.cover_url || item.cover || '',
        typeLabel: item.typeLabel || item.type_label || conf.label,
        tagClass: item.tagClass || item.tag_class || conf.tagClass,
        coverTheme: item.coverTheme || item.cover_theme || conf.theme,
        countLabel,
        contentCount,
        updateDateText,
        meta: item.meta || item.summary || (conf.isSet ? `共 ${contentCount} 个内容 · ${updateDateText}` : '单项详情 · 可进入分 P 播放'),
        actionText: item.actionText || item.action_text || (conf.isSet ? '进入合集详情' : '进入详情'),
        url: item.url || `${conf.base}?id=${item.id || index}`
      };
    });
}

function getFileType(item = {}) {
  const raw = item.fileType || item.file_type || item.type || item.mimeType || item.mime_type || item.extension || item.ext || item.fileUrl || item.file_url || item.title || '';
  const text = String(raw).trim().toLowerCase();

  if (text.includes('pdf') || text.endsWith('.pdf')) return 'PDF';
  if (text.includes('mpeg') || text.includes('mp3') || text.endsWith('.mp3')) return 'MP3';
  if (text.includes('png') || text.endsWith('.png')) return 'PNG';
  if (text.includes('jpeg') || text.includes('jpg') || text.endsWith('.jpg') || text.endsWith('.jpeg')) return 'JPG';
  if (text.includes('octet-stream')) return 'FILE';

  const normalized = text.replace(/^application\//, '').replace(/^audio\//, '').replace(/^image\//, '').replace('.', '').toUpperCase();
  return normalized || 'FILE';
}

function normalizeLibraryItems(data) {
  const items = Array.isArray(data) ? data : data?.items || [];
  return items.map((item) => {
    const fileType = getFileType(item);
    return {
      ...item,
      title: item.title || item.name || '未命名资料',
      fileType,
      coverUrl: item.coverUrl || item.cover_url || item.cover || '',
      sizeText: item.sizeText || item.size_text || item.size || 'PDF',
      updateDateText: item.updateDateText || item.update_date_text || item.updatedAtText || item.updated_at_text || formatDateText(item.updatedAt || item.updated_at || item.createdAt || item.created_at) || '更新日期待同步',
      localPath: item.localPath || item.local_path || ''
    };
  });
}

function normalizeHomeworkHistory(data) {
  const items = Array.isArray(data) ? data : data?.items || data?.records || [];
  return items.map((item) => {
    const time = item.assignmentDate || item.assignment_date || item.createdAt || item.created_at;
    const assignments = (item.assignments || item.items || []).map(normalizeAssignment);
    const first = assignments[0] || {};
    return {
      ...item,
      operationId: item.operationId || item.operation_id || `${time}-${assignments.length}`,
      dateText: formatDateText(time),
      weekText: formatWeekText(time),
      timeText: formatTimeText(time),
      teacherName: item.teacherName || item.teacher_name || first.teacherName || first.teacher_name || '老师',
      title: item.title || item.summary || first.title || '本次作业',
      actionText: item.actionText || item.action_text || (item.deleted ? '老师删除作业' : '老师布置作业'),
      deleted: Boolean(item.deleted || item.isDeleted || item.is_deleted),
      deleteReason: item.deleteReason || item.delete_reason || '',
      assignments,
      practiceRequirement: item.practiceRequirement || item.practice_requirement || first.practiceRequirement || first.practice_requirement || '',
      submitRequirement: item.submitRequirement || item.submit_requirement || first.submitRequirement || first.submit_requirement || ''
    };
  });
}

module.exports = {
  formatDateText,
  formatTimeText,
  formatWeekText,
  normalizeAssignment,
  normalizeHomeworkGroup,
  normalizeCourseItems,
  normalizeLibraryItems,
  normalizeHomeworkHistory
};
