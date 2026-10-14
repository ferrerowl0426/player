const { requireLogin } = require('../../services/auth');
const { getCourses } = require('../../services/courses');
const { normalizeCourseItems } = require('../../utils/format');

const SECTION_TITLES = {
  'knowledge-set': '知识点集',
  'track-set': '曲目集',
  knowledge: '知识点',
  track: '曲目'
};

const SORT_OPTIONS = [
  { value: 'updated_desc', label: '时间倒序' },
  { value: 'updated_asc', label: '时间正序' },
  { value: 'title', label: '按标题' }
];

Page({
  data: {
    section: 'knowledge-set',
    sectionTitle: '知识点集',
    keyword: '',
    sort: 'updated_desc',
    sortLabel: '时间倒序',
    sortOptions: SORT_OPTIONS,
    sortOpen: false,
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

  toggleSort() {
    this.setData({ sortOpen: !this.data.sortOpen });
  },

  selectSort(event) {
    const value = event.currentTarget.dataset.value;
    const option = SORT_OPTIONS.find((item) => item.value === value);
    if (!option || option.value === this.data.sort) {
      this.setData({ sortOpen: false });
      return;
    }
    this.setData({ sort: option.value, sortLabel: option.label, sortOpen: false });
    this.loadCourses();
  },

  async loadCourses() {
    this.setData({ loading: true });
    try {
      const data = await getCourses({ section: this.data.section, keyword: this.data.keyword, sort: this.data.sort });
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
