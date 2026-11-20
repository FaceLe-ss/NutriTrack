/**
 * Camera & Image Processing Module for NutriTrack PWA
 * Handles iOS native camera capture and client-side canvas compression
 */

class NutriCamera {
  constructor() {
    this.fileInput = null;
  }

  init(inputElement) {
    this.fileInput = inputElement;
  }

  /**
   * Compresses an image file down to maxDimension (default 1024px)
   * Reduces 5-10MB iPhone photos to ~100-200KB for instant AI upload.
   */
  async processImageFile(file, maxDimension = 1024, quality = 0.82) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) {
        return reject(new Error('Пожалуйста, выберите файл изображения.'));
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          // Calculate new dimensions
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxDimension) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            }
          } else {
            if (height > maxDimension) {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          // Draw onto canvas for compression
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Get compressed data URL
          const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
          const base64Data = compressedDataUrl.replace(/^data:image\/[a-z]+;base64,/, '');

          // Also generate a small 120px square thumbnail for meal list
          const thumbCanvas = document.createElement('canvas');
          const thumbSize = 120;
          thumbCanvas.width = thumbSize;
          thumbCanvas.height = thumbSize;
          const thumbCtx = thumbCanvas.getContext('2d');

          // Center crop
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          thumbCtx.drawImage(img, sx, sy, minDim, minDim, 0, 0, thumbSize, thumbSize);
          const thumbnailUrl = thumbCanvas.toDataURL('image/jpeg', 0.75);

          resolve({
            fullDataUrl: compressedDataUrl,
            base64: base64Data,
            mimeType: 'image/jpeg',
            thumbnailUrl: thumbnailUrl,
            originalSize: file.size,
            compressedSize: Math.round(base64Data.length * 0.75),
            width: width,
            height: height
          });
        };

        img.onerror = () => reject(new Error('Не удалось декодировать изображение.'));
        img.src = e.target.result;
      };

      reader.onerror = () => reject(new Error('Ошибка чтения файла.'));
      reader.readAsDataURL(file);
    });
  }
}

window.NutriCamera = new NutriCamera();
