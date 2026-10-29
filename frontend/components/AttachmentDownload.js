'use client';

import { useState } from 'react';
import { getApiBaseUrl } from '../lib/api.js';

export default function AttachmentDownload({ resource }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!resource?.download_endpoint && !resource?.file_url) return null;

  async function download() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      // 服务端输出相对授权入口；身份 Cookie 仅发送到配置的 API 地址。
      const endpoint = resource.download_endpoint;
      const match = endpoint?.match(/^\/api(\/attachments\/\d+\/download-url\?source=(?:content|video))$/);
      if (!match) throw new Error('附件下载入口无效');
      const response = await fetch(`${getApiBaseUrl().replace(/\/$/, '')}${match[1]}`, {
        credentials: 'include', cache: 'no-store'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || '获取下载地址失败');
      const url = new URL(result?.data?.url);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('下载地址无效');
      const link = document.createElement('a');
      link.href = url.href;
      link.download = resource.file_name || '';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError(err.message || '附件下载失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  if (!resource.download_endpoint) {
    return <a className="fbtn solid" href={resource.file_url} download={resource.file_name || true}>下载</a>;
  }
  return <span>
    <button type="button" className="fbtn solid" onClick={download} disabled={busy}>{busy ? '获取中…' : '下载'}</button>
    {error && <span role="alert" style={{ display: 'block', fontSize: 12 }}>{error}</span>}
  </span>;
}
