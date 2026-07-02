import VideoPlayer from '../../../components/VideoPlayer.js';
import { fetchVideoById } from '../../../lib/api.js';

function formatDate(dateString) {
  return new Date(dateString).toLocaleString('zh-CN');
}

export default async function VideoDetailPage({ params }) {
  try {
    const { id } = await params;
    const result = await fetchVideoById(id);
    const video = result.data;

    return (
      <section className="player-page">
        <a className="back-link" href="/">← 返回首页</a>
        <VideoPlayer src={video.video_url} poster={video.cover_url} />
        <h1>{video.title}</h1>
        <p className="detail-time">发布时间：{formatDate(video.created_at)}</p>
        <p className="detail-desc">{video.description || '暂无介绍'}</p>
      </section>
    );
  } catch (error) {
    return (
      <section className="player-page">
        <a className="back-link" href="/">← 返回首页</a>
        <p className="error-text">{error.message}</p>
      </section>
    );
  }
}
