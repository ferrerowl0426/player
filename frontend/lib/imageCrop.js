export function getCroppedImageFile({ imageSrc, cropPixels, fileName = 'cover.jpg', mimeType = 'image/jpeg', size = 1200, quality = 0.92 }) {
  return new Promise((resolve, reject) => {
    if (!imageSrc || !cropPixels) {
      reject(new Error('缺少裁切图片或裁切区域'));
      return;
    }

    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('浏览器不支持图片裁切');

        ctx.drawImage(
          image,
          cropPixels.x,
          cropPixels.y,
          cropPixels.width,
          cropPixels.height,
          0,
          0,
          size,
          size
        );

        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('封面裁切失败'));
            return;
          }
          const baseName = fileName.replace(/\.[^.]+$/, '') || 'cover';
          resolve(new File([blob], baseName + '.jpg', { type: mimeType, lastModified: Date.now() }));
        }, mimeType, quality);
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error('图片读取失败'));
    image.src = imageSrc;
  });
}
