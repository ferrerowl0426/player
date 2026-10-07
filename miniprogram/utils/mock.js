function isDevPreview() {
  return wx.getStorageSync('studentToken') === 'dev-preview-token';
}

const homework = {
  operationId: 'dev-op-1',
  assignmentDate: '2026-09-29T18:30:00+08:00',
  teacherName: '李弦安老师',
  practiceRequirement: '卡农 P2 段落衔接，先慢速跟练三遍，节拍器 60。\n天空之城重点练右手分解和弦，低音要保持住。\n每天练琴 20 分钟，手腕放松，保持稳定节奏。\n注意每一遍都要先稳住节拍，再逐步提升速度。',
  submitRequirement: '完成后录制一段卡农 P2 衔接视频，课前发给老师。\n视频请保持画面稳定，声音清晰；遇到问题可以在下次课前留言。',
  assignments: [
    {
      id: 'dev-a1',
      objectType: 'track_part',
      objectId: '1',
      partId: '2',
      title: '卡农 P2 段落衔接',
      coverUrl: '',
      practiceRequirement: '慢速练习右手分解和弦',
      submitRequirement: '录制 30 秒练习视频'
    },
    {
      id: 'dev-a2',
      objectType: 'knowledge_point',
      objectId: '1',
      title: '节拍器基础使用',
      coverUrl: ''
    }
  ]
};

const courseGroups = {
  'knowledge-set': [
    { id: 'ks1', name: '右手分解和弦系统训练', contentCount: 8, updateDateText: '更新于 10 月 7 日' },
    { id: 'ks2', name: '节拍器与稳定速度专题', contentCount: 6, updateDateText: '更新于 10 月 5 日' },
    { id: 'ks3', name: '左手换和弦入门路径', contentCount: 7, updateDateText: '更新于 9 月 28 日' },
    { id: 'ks4', name: '扫弦节奏型组合训练', contentCount: 9, updateDateText: '更新于 9 月 20 日' }
  ],
  'track-set': [
    { id: 'ts1', name: '天空之城指弹入门合集', contentCount: 5, updateDateText: '更新于 10 月 6 日' },
    { id: 'ts2', name: '经典旋律分段练习合集', contentCount: 12, updateDateText: '更新于 10 月 2 日' },
    { id: 'ts3', name: '启蒙阶段 10 首小曲', contentCount: 10, updateDateText: '更新于 9 月 26 日' },
    { id: 'ts4', name: '卡农主题练习合集', contentCount: 6, updateDateText: '更新于 9 月 18 日' }
  ],
  knowledge: [
    { id: 'k1', name: '右手分解和弦：低音保持' },
    { id: 'k2', name: '左手换和弦的提前准备' },
    { id: 'k3', name: '节拍器 60 慢速跟练' },
    { id: 'k4', name: '拨片下拨与上拨稳定' }
  ],
  track: [
    { id: 't1', name: '卡农 · P2 段落衔接练习' },
    { id: 't2', name: '小星星变奏 · 完整分段' },
    { id: 't3', name: '天空之城 · 主歌段落' },
    { id: 't4', name: '送别 · 和弦转换练习' }
  ]
};

const trackCourses = {
  points: courseGroups.track,
  collections: courseGroups['track-set']
};

const knowledgeCourses = {
  points: courseGroups.knowledge,
  collections: courseGroups['knowledge-set']
};

const library = {
  items: [
    { id: '1', title: '卡农 P2 段落衔接练习谱', fileType: 'PDF', sizeText: '2.4 MB', updateDateText: '更新于 10 月 7 日' },
    { id: '2', title: '右手分解和弦课堂讲义', fileType: 'PDF', sizeText: '1.8 MB', updateDateText: '更新于 10 月 6 日' },
    { id: '3', title: '天空之城指弹入门谱例', fileType: 'PDF', sizeText: '3.1 MB', updateDateText: '更新于 10 月 5 日' },
    { id: '4', title: '节拍器练习打卡表', fileType: 'PDF', sizeText: '920 KB', updateDateText: '更新于 10 月 4 日' },
    { id: '5', title: '这是一份用于测试图书馆 PDF 标题超级长时是否会在单行末尾显示省略号而不是换行撑高卡片的课堂练习资料', fileType: 'PDF', sizeText: '4.6 MB', updateDateText: '更新于 10 月 3 日' }
  ]
};

const history = {
  items: [
    {
      operationId: 'dev-history-1',
      assignmentDate: '2026-09-29T20:30:00+08:00',
      teacherName: '李弦安老师',
      title: '卡农 P2 段落衔接练习',
      actionText: '老师布置作业',
      practiceRequirement: '重点看 P2 的段落衔接，跟练时开节拍器 60。\n第二遍试着把速度提到 72。',
      submitRequirement: '请拍摄完整练习视频，保持画面稳定并上传。',
      assignments: [
        { id: 'h1-1', objectType: 'track_point', objectId: '1', title: '卡农独奏全曲精讲' },
        { id: 'h1-2', objectType: 'track_part', objectId: '1', partId: '2', title: '卡农 P2 分段讲解' },
        { id: 'h1-3', objectType: 'knowledge_point', objectId: 'k1', title: '右手分解和弦基础' },
        { id: 'h1-4', objectType: 'library_pdf', objectId: 'pdf1', title: '卡农 P2 段落衔接练习谱' }
      ]
    },
    {
      operationId: 'dev-history-2',
      assignmentDate: '2026-09-29T18:00:00+08:00',
      teacherName: '李弦安老师',
      title: '指弹入门基础指法练习',
      actionText: '老师布置作业',
      practiceRequirement: '先完成基础指法练习，每条练习至少慢速弹三遍。',
      submitRequirement: '',
      assignments: [{ id: 'h2-1', objectType: 'track_collection', objectId: 'ts1', title: '指弹入门 30 首' }]
    },
    {
      operationId: 'dev-history-3',
      assignmentDate: '2026-09-05T21:47:00+08:00',
      teacherName: '李弦安老师',
      title: '天空之城指弹改编练习',
      actionText: '老师布置作业',
      practiceRequirement: '天空之城全曲过一遍，P2 慢速跟练三遍再提速。',
      submitRequirement: '请提交慢速跟练视频，能看清左右手动作。',
      assignments: [
        { id: 'h3-1', objectType: 'track_point', objectId: 't3', title: '天空之城指弹改编' },
        { id: 'h3-2', objectType: 'track_part', objectId: 't3', partId: '2', title: '天空之城 P2 分段讲解' }
      ]
    },
    {
      operationId: 'dev-history-4',
      assignmentDate: '2026-08-25T19:40:00+08:00',
      teacherName: '李弦安老师',
      title: '宫崎骏动画曲集重复布置记录',
      actionText: '老师删除作业',
      deleted: true,
      deleteReason: '原因：重复布置',
      practiceRequirement: '',
      submitRequirement: '',
      assignments: [
        { id: 'h4-1', objectType: 'track_collection', objectId: 'ts2', title: '宫崎骏动画曲集' },
        { id: 'h4-2', objectType: 'track_point', objectId: 't4', title: '千与千寻 Always With Me' }
      ]
    }
  ]
};

module.exports = {
  isDevPreview,
  homework,
  courseGroups,
  trackCourses,
  knowledgeCourses,
  library,
  history
};
