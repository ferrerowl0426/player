const { requireLogin } = require('../../services/auth');
const { getCourses } = require('../../services/courses');
const { normalizeCourseItems } = require('../../utils/format');

const SECTION_TITLES = {
  'knowledge-set': '知识点集',
  'track-set': '曲目集',
  knowledge: '知识点',
  track: '曲目'
};

Page({
  data: {
    section: 'knowledge-set',
    sectionTitle: '知识点集',
    keyword: '',
    loading: false,
    items: []
  },

  onShow() {
    if (!requireLogin()) return;
    this.loadCourses();
  },

  onPullDownRefresh() {
    this.loadCourses().finally(() => wx.stopPullDownRefresh());
  },

  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
    this.loadCourses();
  },

  clearKeyword() {
    this.setData({ keyword: '' });
    this.loadCourses();
  },

  changeSection(event) {
    const section = event.currentTarget.dataset.section;
    this.setData({ section, sectionTitle: SECTION_TITLES[section] || '课程', keyword: '' });
    this.loadCourses();
    this.backToTop();
  },

  async loadCourses() {
    this.setData({ loading: true });
    try {
      const data = await getCourses({ section: this.data.section, keyword: this.data.keyword });
      this.setData({ items: normalizeCourseItems(data, this.data.section, this.data.keyword) });
    } catch (error) {
      this.setData({ items: [] });
      wx.showToast({ title: error.userMessage || '课程加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  openCourse(event) {
    const item = event.currentTarget.dataset.item;
    wx.navigateTo({ url: item.url });
  },

  backToTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 240 });
  }
});
