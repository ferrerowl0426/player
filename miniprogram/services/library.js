const { request } = require('./request');

function getLibrary({ keyword } = {}) {
  const text = String(keyword || '').trim();
  const query = text ? `?keyword=${encodeURIComponent(text)}` : '';
  return request({ url: `/library${query}` });
}

function getLibraryDetail(id) {
  return request({ url: `/library/${id}` });
}

module.exports = {
  getLibrary,
  getLibraryDetail
};
