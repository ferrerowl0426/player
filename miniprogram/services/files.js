const { request } = require('./request');

function getFileType(file = {}) {
  const raw = String(file.fileType || file.type || file.mimeType || file.mime_type || file.extension || '').toLowerCase();
  const title = String(file.title || file.name || file.fileName || file.file_name || '').toLowerCase();
  if (raw.includes('pdf') || title.endsWith('.pdf')) return 'pdf';
  if (raw.includes('mpeg') || raw.includes('mp3') || title.endsWith('.mp3')) return 'mp3';
  if (raw.includes('png') || title.endsWith('.png')) return 'png';
  if (raw.includes('jpeg') || raw.includes('jpg') || title.endsWith('.jpg') || title.endsWith('.jpeg')) return 'jpg';
  return raw.split('/').pop() || 'file';
}

function getSignedUrl(fileId, source = 'library') {
  return request({ url: `/files/${fileId}/signed-url?source=${encodeURIComponent(source)}` });
}

function downloadAndOpenDocument(url, type) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success(res) {
        if (res.statusCode !== 200 || !res.tempFilePath) {
          const error = new Error('文件下载失败');
          error.userMessage = '文件下载失败';
          reject(error);
          return;
        }
        wx.openDocument({
          filePath: res.tempFilePath,
          fileType: type === 'pdf' ? 'pdf' : undefined,
          showMenu: true,
          success: resolve,
          fail() {
            const error = new Error('文件打开失败');
            error.userMessage = '文件打开失败';
            reject(error);
          }
        });
      },
      fail(err) {
        const error = new Error(err?.errMsg || '文件下载失败');
        error.userMessage = '文件下载失败，请检查开发者工具是否关闭域名校验';
        reject(error);
      }
    });
  });
}

async function openLibraryFile(file) {
  if (!file || !file.id) {
    const error = new Error('文件信息不完整');
    error.userMessage = '文件信息不完整';
    throw error;
  }

  const type = getFileType(file);

  if (type === 'mp3') {
    wx.navigateTo({
      url: `/pages/audio-player/index?fileId=${file.id}&fileSource=${encodeURIComponent(file.fileSource || file.sourceType || 'library')}&title=${encodeURIComponent(file.title || '')}&source=${encodeURIComponent(file.source || file.sourceText || '资料库')}`
    });
    return;
  }

  const signed = await getSignedUrl(file.id, file.fileSource || file.sourceType || 'library');
  const url = signed.url || signed.signedUrl;

  if (!url) {
    const error = new Error('文件地址获取失败');
    error.userMessage = '文件地址获取失败';
    throw error;
  }

  if (type === 'jpg' || type === 'jpeg' || type === 'png') {
    wx.previewImage({ urls: [url] });
    return;
  }

  await downloadAndOpenDocument(url, type);
}

module.exports = {
  getSignedUrl,
  openLibraryFile
};
