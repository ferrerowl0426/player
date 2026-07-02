import path from 'node:path';
import multer from 'multer';

// multer 是 Express 里常用的文件上传中间件。
// 前端用 FormData 上传视频和封面时，后端就靠 multer 解析文件。
const storage = multer.diskStorage({
  destination(req, file, callback) {
    callback(null, path.resolve('uploads/temp'));
  },
  filename(req, file, callback) {
    // 文件名里加时间戳，避免两个用户上传同名文件时互相覆盖。
    const uniqueName = `${Date.now()}-${file.originalname}`;
    callback(null, uniqueName);
  }
});

export const MAX_VIDEO_SIZE = 500 * 1024 * 1024;
export const MAX_COVER_SIZE = 5 * 1024 * 1024;

const allowedVideoExtensions = ['.mp4', '.webm', '.mov'];
const allowedImageExtensions = ['.jpg', '.jpeg', '.png', '.webp'];

function getFileExtension(file) {
  return path.extname(file.originalname).toLowerCase();
}

export const upload = multer({
  storage,
  limits: {
    // 这里设置一个总上限，具体视频/封面大小在路由里分别校验。
    fileSize: MAX_VIDEO_SIZE
  },
  fileFilter(req, file, callback) {
    const extension = getFileExtension(file);

    if (file.fieldname === 'video') {
      if (!file.mimetype.startsWith('video/')) {
        callback(new Error('请上传视频文件'));
        return;
      }

      if (!allowedVideoExtensions.includes(extension)) {
        callback(new Error('视频格式只支持 mp4、webm、mov'));
        return;
      }
    }

    if (file.fieldname === 'cover') {
      if (!file.mimetype.startsWith('image/')) {
        callback(new Error('封面必须是图片文件'));
        return;
      }

      if (!allowedImageExtensions.includes(extension)) {
        callback(new Error('封面格式只支持 jpg、jpeg、png、webp'));
        return;
      }
    }

    callback(null, true);
  }
});
