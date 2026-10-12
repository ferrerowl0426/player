'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Cropper from 'react-easy-crop';
import { getCroppedImageFile } from '../lib/imageCrop.js';

export default function CoverCropperModal({ file, title = '裁切封面', aspect = 1, outputSize = 1200, onCancel, onConfirm }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const imageSrc = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);

  useEffect(() => {
    return () => {
      if (imageSrc) URL.revokeObjectURL(imageSrc);
    };
  }, [imageSrc]);

  const handleCropComplete = useCallback((_, pixels) => {
    setCroppedAreaPixels(pixels);
  }, []);

  async function handleConfirm() {
    if (!file || !imageSrc || !croppedAreaPixels || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const croppedFile = await getCroppedImageFile({
        imageSrc,
        cropPixels: croppedAreaPixels,
        fileName: file.name,
        size: outputSize
      });
      await onConfirm?.(croppedFile);
    } catch (err) {
      setError(err.message || '封面裁切失败');
      setSubmitting(false);
    }
  }

  if (!file) return null;

  return (
    <div className="crop-modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="crop-modal-card">
        <div className="crop-modal-head">
          <div>
            <h3>{title}</h3>
            <p>拖动或缩放图片，把要保留的部分放进正方形框内。</p>
          </div>
          <button type="button" className="ghost-btn" onClick={onCancel} disabled={submitting}>取消</button>
        </div>
        <div className="crop-stage">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={handleCropComplete}
            showGrid={false}
          />
        </div>
        <label className="crop-zoom-row">
          <span>缩放</span>
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="crop-actions">
          <button type="button" className="ghost-btn" onClick={onCancel} disabled={submitting}>取消，保留原封面</button>
          <button type="button" className="primary-btn" onClick={handleConfirm} disabled={submitting}>
            {submitting ? '处理中...' : '确认裁切并上传'}
          </button>
        </div>
      </div>
    </div>
  );
}
