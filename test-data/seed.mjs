// 测试初始数据种子脚本：仅写入 test-data 设计的数据，不修改业务代码。
// 用法：先确保后端已启动过一次，再执行 node seed.mjs。
// 清除：node clean.mjs。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { config } from '../backend/src/config.js';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const bcrypt = require('bcryptjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, 'assets');
const MANIFEST_PATH = path.join(HERE, 'manifest.json');
const TEST_PASSWORD = 'demo123';

if (!config.s3.publicBaseUrl) throw new Error('缺少 PUBLIC_BUCKET_BASE_URL 配置');
if (fs.existsSync(MANIFEST_PATH)) throw new Error('检测到 manifest.json，请先执行 node clean.mjs');

const pool = new Pool({ connectionString: config.databaseUrl });
const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey }
});
const publicUrl = (key) => `${config.s3.publicBaseUrl.replace(/\/$/, '')}/${key}`;
const manifest = {
  generatedAt: new Date().toISOString(),
  uploadedKeys: [],
  ids: {
    videos: [], track_points: [], track_collections: [], knowledge_points: [], knowledge_collections: [],
    content_attachments: [], library_resources: [], user_assignments: [], deletion_logs: [],
    teaching_classes: [], admins: [], users: []
  },
  prerequisites: []
};

async function q(sql, params = []) { return (await pool.query(sql, params)).rows; }
async function upload(key, relativeFile, contentType) {
  const body = fs.readFileSync(path.join(ASSETS, relativeFile));
  await s3.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: contentType }));
  manifest.uploadedKeys.push(key);
  return { url: publicUrl(key), size: body.length, key };
}
const ASSIGNMENT_BASE_DATE = new Date('2026-09-17T00:00:00+08:00');
function assignmentDate(daysBeforeBase, hour = 10) {
  const d = new Date(ASSIGNMENT_BASE_DATE.getTime() - daysBeforeBase * 86400000);
  d.setHours(hour, 0, 0, 0);
  return d;
}

const longPractice = `本次练习要求比较细，请完整读完后再开始录制：第一步，先把节拍器调到六十，每个小节只弹骨架音，右手不要抢拍，左手换把前先确认大拇指没有用力顶住琴颈；第二步，把今天推送的 1 到 5 个内容按顺序练，每个内容至少循环三遍，第一遍只看手型，第二遍听节拍，第三遍再追求连贯；第三步，把最容易错的两小节单独拿出来慢练，错一次就回到前一小节重新接，不要从头硬冲；第四步，如果昨天推送过同一个视频，今天仍然要重新练，因为老师要比较同一段内容在不同日期的稳定性变化，不要因为历史记录里出现过就跳过。练习过程中请记录卡住的位置、错因和调整办法，尤其注意分 P 视频只练指定 P，不要自动扩展到整首。最后五分钟做放松复盘，把今天最稳的一遍和最不稳的一遍都保留下来，方便下次对比。`;
const longSubmit = `提交要求也请严格执行：视频开头先口述自己的姓名、日期、练习内容和当前速度，然后按老师推送顺序演奏。若本次作业包含合集、单曲目、单知识点或具体分 P，请逐项说明“我现在提交第几个内容”，不要把多个内容混在一个标题里。录制时手机横放或竖放都可以，但双手、琴弦和节拍器声音要清楚；中途弹错不要剪辑，继续往后弹，老师要看你遇到错误后的恢复能力。提交文字里至少写三件事：本次练了多久、最困难的位置、明天准备怎么改。若有 mp3、jpg、pdf 附件，请先下载查看后再提交，说明你参考了哪一个附件。不要只写“已完成”，也不要只发一个视频链接；如果当天无法录制，请写明原因、预计补交时间和已经完成的慢练部分。`;
const shortPractice = '先慢速练习换把和节拍，确认动作稳定后再提高速度；若昨天练过同一视频，今天仍需重新练一遍用于对比。';
const shortSubmit = '提交一段完整练习视频，并附本次练习时长、最困难位置和下一步调整计划。';

async function insertAssignment(userId, adminId, days, row, deleted = false, operationId = null) {
  const columns = [
    'user_id', 'video_id', 'object_type', 'object_id', 'part_id', 'assigned_object_title', 'assigned_video_title',
    'message', 'practice_requirement', 'submit_requirement', 'assigned_by_admin_id', 'is_deleted', 'delete_reason', 'deleted_at', 'created_at'
  ];
  const values = [
    userId, row.videoId || null, row.objectType, row.objectId, row.partId || null, row.title, row.videoTitle || row.title,
    '', row.practice || '', row.submit || '', adminId, deleted, deleted ? row.deleteReason : '', deleted ? assignmentDate(days, 21) : null, assignmentDate(days, row.hour || 10)
  ];
  if (operationId) {
    columns.push('operation_id');
    values.push(operationId);
  }
  const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
  const result = await q(
    `INSERT INTO user_assignments (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id, operation_id`,
    values
  );
  manifest.ids.user_assignments.push(result[0].id);
  return result[0];
}
async function insertAssignmentBatch(userId, adminId, days, rows, deleted = false) {
  let operationId = null;
  for (const [index, row] of rows.entries()) {
    const inserted = await insertAssignment(userId, adminId, days, row, deleted && index === 0, operationId);
    operationId = inserted.operation_id;
  }
  return operationId;
}

async function main() {
  console.log('== 1/8 准备账号与班级 ==');
  const dean = (await q(`INSERT INTO admins (username, account, nickname, password_hash, role, status)
    VALUES ('dean_yuhan', '13900000002', '教务雨涵老师', $1, 'super_admin', 'active') RETURNING id`, [bcrypt.hashSync(TEST_PASSWORD, 10)]))[0];
  manifest.ids.admins.push(dean.id);
  const teacherDefs = [
    ['teacher_luxiang', '13900000011', '鲁祥老师'],
    ['teacher_yuanyuan', '13900000012', '缘缘老师'],
    ['teacher_zhangning', '13900000013', '张宁老师']
  ];
  const teachers = {};
  for (const [username, account, nickname] of teacherDefs) {
    const row = (await q(`INSERT INTO admins (username, account, nickname, password_hash, role, status)
      VALUES ($1, $2, $3, $4, 'teacher', 'active') RETURNING id`, [username, account, nickname, bcrypt.hashSync(TEST_PASSWORD, 10)]))[0];
    teachers[username] = row.id;
    manifest.ids.admins.push(row.id);
  }

  const classDefs = [
    ['测试一班', teachers.teacher_luxiang], ['测试二班', teachers.teacher_luxiang],
    ['测试三班', teachers.teacher_yuanyuan], ['测试四班', teachers.teacher_zhangning]
  ];
  const classes = {};
  for (const [name, teacherId] of classDefs) {
    const row = (await q(`INSERT INTO teaching_classes (name, teacher_id) VALUES ($1, $2) RETURNING id`, [name, teacherId]))[0];
    classes[name] = row.id;
    manifest.ids.teaching_classes.push(row.id);
    await q(`INSERT INTO teacher_classes (teacher_id, class_id) VALUES ($1, $2)`, [teacherId, row.id]);
  }

  const studentNames = [
    ['林知夏', '13800001001'], ['周予安', '13800001002'], ['沈嘉木', '13800001003'], ['顾星河', '13800001004'],
    ['许清禾', '13800001005'], ['江晚晴', '13800001006'], ['陆景行', '13800001007'], ['苏念安', '13800001008'],
    ['程一诺', '13800001009'], ['叶书言', '13800001010'], ['唐沐阳', '13800001011'], ['宋知遥', '13800001012'],
    ['白若溪', '13800001013'], ['韩子墨', '13800001014'], ['顾南乔', '13800001015'], ['秦以安', '13800001016']
  ];
  const studentMap = {};
  for (let i = 0; i < studentNames.length; i += 1) {
    const className = classDefs[Math.floor(i / 4)][0];
    const [nickname, account] = studentNames[i];
    const username = `test_student_${String(i + 1).padStart(2, '0')}`;
    const disabled = [2, 7, 12, 15].includes(i);
    const row = (await q(`INSERT INTO users (username, account, nickname, password_hash, class_id, status, is_active, is_marked)
      VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE) RETURNING id`,
      [username, account, nickname, bcrypt.hashSync(TEST_PASSWORD, 10), classes[className], disabled ? 'disabled' : 'active', !disabled]))[0];
    studentMap[username] = row.id;
    manifest.ids.users.push(row.id);
  }

  console.log('== 2/8 上传视频、图片、附件 ==');
  const videos = [];
  for (const [name, file] of [['flower', 'sample-a.mp4'], ['friday', 'friday.mp4'], ['slow', 'sample-5s.mp4']]) {
    videos.push({ name, ...(await upload(`test-data/videos/${name}.mp4`, file, 'video/mp4')) });
  }
  const coverFiles = ['cover-canon.jpg', 'cover-sunny.jpg', 'cover-jay.jpg', 'cover-classics.jpg', 'cover-kp-1645.jpg', 'cover-kp-hammer.jpg', 'cover-kc-basics.jpg', 'cover-library.jpg'];
  const covers = {};
  for (const file of coverFiles) covers[file] = await upload(`test-data/covers/${file}`, `covers/${file}`, 'image/jpeg');
  covers['chord-chart.png'] = await upload('test-data/covers/chord-chart.png', 'covers/chord-chart.png', 'image/png');
  const pdfs = {};
  for (const file of ['canon-score.pdf', 'fingerstyle-basics.pdf', 'chord-cheatsheet.pdf']) pdfs[file] = await upload(`test-data/docs/${file}`, `docs/${file}`, 'application/pdf');
  const audios = { 'metronome-demo.mp3': await upload('test-data/docs/metronome-demo.mp3', 'docs/metronome-demo.mp3', 'audio/mpeg') };

  console.log('== 3/8 创建视频档位 ==');
  const videoRows = [];
  for (let i = 0; i < 18; i += 1) {
    const source = videos[i % videos.length];
    const cover = Object.values(covers)[i % 7];
    const title = `测试视频 ${String(i + 1).padStart(2, '0')}`;
    const row = (await q(`INSERT INTO videos (title, description, video_url, cover_url) VALUES ($1, $2, $3, $4) RETURNING id`, [title, '用于测试多 P 播放、历史作业和排版的网络样例视频。', source.url, cover.url]))[0];
    manifest.ids.videos.push(row.id);
    await q(`INSERT INTO video_renditions (video_id, quality, video_url, file_size, status) VALUES ($1, 'source', $2, $3, 'ready'), ($1, '1080p', $2, $3, 'ready'), ($1, '720p', $2, $3, 'ready')`, [row.id, source.url, source.size]);
    videoRows.push(row.id);
  }

  console.log('== 4/8 创建曲目区：20 曲目 + 5 合集 ==');
  const trackDefs = [
    ['卡农', 'cover-canon.jpg', '帕赫贝尔卡农指弹改编，包含示范、分段讲解和慢速跟练。'],
    ['晴天', 'cover-sunny.jpg', '前奏与分解和弦练习。'], ['稻香', 'cover-jay.jpg', '节拍与旋律连接练习。'],
    ['南山南', 'cover-classics.jpg', '民谣伴奏型练习。'], ['小星星变奏曲', 'cover-canon.jpg', '基础旋律与变奏练习。'],
    ['成都', 'cover-classics.jpg', '扫弦与情绪推进练习。'], ['平凡之路', 'cover-sunny.jpg', '八分音符律动与副歌推进。'],
    ['后来', 'cover-jay.jpg', '分解和弦与旋律线衔接。'], ['童年', 'cover-canon.jpg', '基础扫弦入门曲。'], ['夜空中最亮的星', 'cover-classics.jpg', '强弱层次和副歌爆发练习。'],
    ['贝加尔湖畔', 'cover-sunny.jpg', '慢速抒情伴奏与延音控制。'], ['旅行的意义', 'cover-jay.jpg', '切分节奏与转位和弦。'], ['演员', 'cover-classics.jpg', '流行伴奏型变化练习。'],
    ['起风了', 'cover-canon.jpg', '速度控制与段落连接。'], ['七里香', 'cover-jay.jpg', '前奏动机与右手分解。'], ['红豆', 'cover-sunny.jpg', '慢歌呼吸和和声走向。'],
    ['斑马斑马', 'cover-classics.jpg', '民谣叙事型伴奏。'], ['蒲公英的约定', 'cover-jay.jpg', '副歌层次与装饰音。'], ['海阔天空', 'cover-canon.jpg', '开放和弦与大横按切换。'],
    ['突然好想你', 'cover-sunny.jpg', '抒情扫弦与节拍稳定性。']
  ];
  const tracks = [];
  for (const [name, coverFile, description] of trackDefs) {
    const row = (await q(`INSERT INTO track_points (name, cover, description) VALUES ($1, $2, $3) RETURNING id`, [name, covers[coverFile].url, description]))[0];
    manifest.ids.track_points.push(row.id); tracks.push(row);
  }
  const trackPartIds = {};
  let videoIndex = 0;
  for (let i = 0; i < tracks.length; i += 1) {
    const count = [3, 2, 4, 1, 2, 3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 3, 1, 2, 3, 1][i]; trackPartIds[tracks[i].id] = [];
    for (let p = 1; p <= count; p += 1) {
      const title = p === 1 ? '完整示范' : p === 2 ? '分段讲解' : p === 3 ? '慢速跟练' : '易错小节';
      const part = (await q(`INSERT INTO track_parts (track_id, part_no, video_id, title, duration) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [tracks[i].id, p, videoRows[videoIndex++ % videoRows.length], title, 5 + p]))[0];
      trackPartIds[tracks[i].id].push(part.id);
    }
  }
  const trackCollections = [];
  const trackCollectionDefs = [
    ['周杰伦精选', 'cover-jay.jpg', '周杰伦作品指弹练习合集。'], ['经典指弹入门', 'cover-classics.jpg', '从旋律、节拍到伴奏的入门合集。'],
    ['民谣弹唱进阶', 'cover-sunny.jpg', '常见民谣弹唱、扫弦和切分训练。'], ['流行慢歌精选', 'cover-canon.jpg', '慢歌呼吸、延音与和声进行训练。'],
    ['舞台演奏挑战', 'cover-kp-hammer.jpg', '适合阶段验收和完整演奏展示的曲目合集。']
  ];
  for (const [name, coverFile, description] of trackCollectionDefs) {
    const row = (await q(`INSERT INTO track_collections (name, cover, description) VALUES ($1, $2, $3) RETURNING id`, [name, covers[coverFile].url, description]))[0];
    manifest.ids.track_collections.push(row.id); trackCollections.push(row);
  }
  const trackCollectionItems = [
    [0, [1, 2, 14, 17, 19]], [1, [0, 1, 4, 8, 15]], [2, [3, 5, 6, 9, 11, 16]], [3, [7, 10, 12, 13, 15, 19]], [4, [0, 2, 9, 14, 18]]
  ];
  for (const [collectionIndex, itemIndexes] of trackCollectionItems) {
    for (const itemIndex of itemIndexes) await q(`INSERT INTO track_collection_items (collection_id, track_id) VALUES ($1,$2)`, [trackCollections[collectionIndex].id, tracks[itemIndex].id]);
  }

  console.log('== 5/8 创建知识点区：20 知识点 + 5 合集 ==');
  const kpDefs = [
    ['1645 和弦进行', 'cover-kp-1645.jpg', '经典 I-vi-IV-V 进行与伴奏应用。'], ['击弦与勾弦', 'cover-kp-hammer.jpg', '左手技巧和力度控制。'],
    ['右手交替拨弦', 'cover-kc-basics.jpg', '交替拨弦的稳定性训练。'], ['节拍器使用', 'cover-classics.jpg', '从慢速到原速的节拍练习。'], ['基础乐理识谱', 'cover-jay.jpg', '六线谱、节奏型和重复记号。'],
    ['大横按入门', 'cover-kp-hammer.jpg', 'F 和弦与手腕角度训练。'], ['切音技巧', 'cover-kc-basics.jpg', '右手闷音和律动控制。'], ['滑音连接', 'cover-classics.jpg', '旋律连接中的滑音应用。'],
    ['泛音基础', 'cover-canon.jpg', '自然泛音位置和发声练习。'], ['扫弦强弱', 'cover-sunny.jpg', '上下扫与重音层次。'], ['和弦转位', 'cover-jay.jpg', '常见转位指型和连接。'],
    ['三连音节奏', 'cover-kp-1645.jpg', '三连音律动与节拍器训练。'], ['布鲁斯音阶', 'cover-kp-hammer.jpg', '小调五声音阶与蓝调音。'], ['右手靠弦', 'cover-kc-basics.jpg', '靠弦与不靠弦的音色差异。'],
    ['左手放松', 'cover-classics.jpg', '长时间练习时的放松方法。'], ['变调夹使用', 'cover-canon.jpg', '变调夹位置与调性变化。'], ['指弹低音线', 'cover-sunny.jpg', '低音声部独立训练。'],
    ['旋律加花', 'cover-jay.jpg', '主旋律装饰音设计。'], ['乐句呼吸', 'cover-kp-1645.jpg', '段落停顿与情绪表达。'], ['录视频自检', 'cover-library.jpg', '提交作业前的画面与声音检查。']
  ];
  const points = [];
  for (const [name, coverFile, description] of kpDefs) {
    const row = (await q(`INSERT INTO knowledge_points (name, cover, description) VALUES ($1, $2, $3) RETURNING id`, [name, covers[coverFile].url, description]))[0];
    manifest.ids.knowledge_points.push(row.id); points.push(row);
  }
  const kpPartIds = {};
  for (let i = 0; i < points.length; i += 1) {
    const count = [3, 2, 2, 1, 3, 2, 4, 1, 2, 3, 1, 2, 4, 2, 1, 3, 2, 1, 3, 2][i]; kpPartIds[points[i].id] = [];
    for (let p = 1; p <= count; p += 1) {
      const part = (await q(`INSERT INTO knowledge_parts (knowledge_point_id, part_no, video_id, title, duration) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [points[i].id, p, videoRows[videoIndex++ % videoRows.length], `知识点第 ${p} 段`, 5 + p]))[0];
      kpPartIds[points[i].id].push(part.id);
    }
  }
  const kpCollections = [];
  const kpCollectionDefs = [
    ['指弹基础知识点', 'cover-kc-basics.jpg', '和弦、拨弦和节拍基础。'], ['练琴方法与乐理', 'cover-classics.jpg', '识谱、节拍和练琴方法。'],
    ['左手技巧专项', 'cover-kp-hammer.jpg', '击弦、滑音、大横按和放松专项。'], ['右手节奏专项', 'cover-sunny.jpg', '扫弦、切音、靠弦和低音线训练。'],
    ['舞台提交规范', 'cover-library.jpg', '录制、提交和自检相关知识点。']
  ];
  for (const [name, coverFile, description] of kpCollectionDefs) {
    const row = (await q(`INSERT INTO knowledge_collections (name, cover, description) VALUES ($1, $2, $3) RETURNING id`, [name, covers[coverFile].url, description]))[0];
    manifest.ids.knowledge_collections.push(row.id); kpCollections.push(row);
  }
  const kpCollectionItems = [
    [0, [0, 1, 2, 5, 10]], [1, [3, 4, 11, 15, 18]], [2, [1, 5, 7, 14, 17]], [3, [2, 6, 9, 13, 16]], [4, [12, 18, 19, 3, 4]]
  ];
  for (const [collectionIndex, itemIndexes] of kpCollectionItems) {
    for (const itemIndex of itemIndexes) await q(`INSERT INTO knowledge_collection_items (collection_id, knowledge_point_id) VALUES ($1,$2)`, [kpCollections[collectionIndex].id, points[itemIndex].id]);
  }

  console.log('== 6/8 创建附件、3 本图书并建立多种关联 ==');
  const attachments = [
    ['track_point', tracks[0].id, '卡农曲谱.pdf', pdfs['canon-score.pdf']], ['track_point', tracks[0].id, '和弦图.png', covers['chord-chart.png']], ['track_point', tracks[0].id, '卡农节拍器.mp3', audios['metronome-demo.mp3'], 'audio/mpeg'],
    ['track_point', tracks[2].id, '稻香练习说明.pdf', pdfs['fingerstyle-basics.pdf']], ['track_point', tracks[2].id, '稻香手型图.jpg', covers['chord-chart.png'], 'image/jpeg'],
    ['track_point', tracks[7].id, '后来分解和弦.pdf', pdfs['canon-score.pdf']], ['track_point', tracks[14].id, '七里香前奏图.jpg', covers['chord-chart.png'], 'image/jpeg'],
    ['track_collection', trackCollections[1].id, '节拍器音频.mp3', audios['metronome-demo.mp3'], 'audio/mpeg'], ['track_collection', trackCollections[3].id, '慢歌合集说明.pdf', pdfs['fingerstyle-basics.pdf']],
    ['knowledge_point', points[0].id, '和弦速查表.pdf', pdfs['chord-cheatsheet.pdf']], ['knowledge_point', points[0].id, '1645节拍器.mp3', audios['metronome-demo.mp3'], 'audio/mpeg'],
    ['knowledge_point', points[1].id, '击勾弦练习图.jpg', covers['chord-chart.png'], 'image/jpeg'], ['knowledge_point', points[6].id, '切音示意图.jpg', covers['chord-chart.png'], 'image/jpeg'],
    ['knowledge_point', points[12].id, '布鲁斯音阶练习.pdf', pdfs['canon-score.pdf']], ['knowledge_collection', kpCollections[2].id, '左手技巧合集说明.pdf', pdfs['fingerstyle-basics.pdf']]
  ];
  for (const [type, objectId, fileName, file, explicitType] of attachments) {
    const fileType = explicitType || (fileName.endsWith('.pdf') ? 'application/pdf' : fileName.endsWith('.mp3') ? 'audio/mpeg' : fileName.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
    const row = (await q(`INSERT INTO content_attachments (object_type, object_id, file_name, file_url, file_key, file_type, file_size) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [type, objectId, fileName, file.url, file.key, fileType, file.size]))[0];
    manifest.ids.content_attachments.push(row.id);
  }
  const libraryDefs = [
    ['指弹吉他基础教程', '从姿势、节拍到交替拨弦的基础教材。', 'fingerstyle-basics.pdf', 'cover-classics.jpg', [['track_point', tracks[0].id], ['track_collection', trackCollections[1].id], ['knowledge_collection', kpCollections[0].id]]],
    ['常用和弦速查表', '常见和弦进行和按弦提示。', 'chord-cheatsheet.pdf', 'cover-kp-1645.jpg', [['track_point', tracks[1].id], ['track_collection', trackCollections[0].id], ['knowledge_point', points[0].id], ['knowledge_collection', kpCollections[0].id]]],
    ['练琴与识谱手册', '节拍器、六线谱和提交练习视频的说明。', 'canon-score.pdf', 'cover-jay.jpg', [['track_collection', trackCollections[0].id], ['knowledge_collection', kpCollections[1].id], ['knowledge_point', points[4].id]]],
    ['民谣弹唱训练册', '扫弦、切音和民谣曲目练习说明。', 'fingerstyle-basics.pdf', 'cover-sunny.jpg', [['track_point', tracks[5].id], ['track_collection', trackCollections[2].id], ['knowledge_point', points[6].id], ['knowledge_collection', kpCollections[3].id]]],
    ['舞台提交检查表', '演出前自检、录制作业和提交规范。', 'chord-cheatsheet.pdf', 'cover-library.jpg', [['track_point', tracks[18].id], ['track_collection', trackCollections[4].id], ['knowledge_point', points[19].id], ['knowledge_collection', kpCollections[4].id]]],
    ['慢歌表现力手册', '慢歌呼吸、延音和层次处理。', 'canon-score.pdf', 'cover-canon.jpg', [['track_point', tracks[7].id], ['track_collection', trackCollections[3].id], ['knowledge_point', points[18].id], ['knowledge_collection', kpCollections[1].id]]]
  ];
  const libraries = [];
  for (const [title, description, fileName, coverFile, links] of libraryDefs) {
    const row = (await q(`INSERT INTO library_resources (title, description, cover, file_name, file_url, file_key, file_type, file_size, uploader_id, uploader_name) VALUES ($1,$2,$3,$4,$5,$6,'application/pdf',$7,$8,$9) RETURNING id`, [title, description, covers[coverFile].url, fileName, pdfs[fileName].url, pdfs[fileName].key, pdfs[fileName].size, dean.id, '教务雨涵老师']))[0];
    manifest.ids.library_resources.push(row.id); libraries.push(row);
    for (const [objectType, objectId] of links) await q(`INSERT INTO library_resource_links (library_resource_id, object_type, object_id) VALUES ($1,$2,$3)`, [row.id, objectType, objectId]);
  }

  console.log('== 7/8 建立前置知识点与删除痕迹 ==');
  const prerequisites = [[ 'track_point', tracks[1].id, 'track_point', tracks[0].id ], [ 'track_point', tracks[2].id, 'knowledge_point', points[0].id ], [ 'knowledge_point', points[1].id, 'knowledge_collection', kpCollections[0].id ], [ 'knowledge_point', points[4].id, 'knowledge_point', points[3].id ]];
  for (const p of prerequisites) { await q(`INSERT INTO prerequisites (object_type, object_id, prerequisite_type, prerequisite_id) VALUES ($1,$2,$3,$4)`, p); manifest.prerequisites.push({ object_type: p[0], object_id: p[1], prerequisite_type: p[2], prerequisite_id: p[3] }); }
  const deletedLog = (await q(`INSERT INTO deletion_logs (object_type, object_id, object_title, admin_id) VALUES ('track_point', $1, '测试删除痕迹：旧版分解练习', $2) RETURNING id`, [tracks[4].id, dean.id]))[0];
  manifest.ids.deletion_logs.push(deletedLog.id);

  console.log('== 8/8 生成 2026-09-18 之前的历史作业、长文本排版、软删除记录 ==');
  const studentIds = Object.values(studentMap);
  const workRows = [
    { objectType: 'track_point', objectId: tracks[0].id, partId: trackPartIds[tracks[0].id][0], title: '卡农 P1 完整示范', videoTitle: '卡农 P1 完整示范', practice: longPractice, submit: longSubmit },
    { objectType: 'track_point', objectId: tracks[0].id, partId: trackPartIds[tracks[0].id][1], title: '卡农 P2 分段讲解', videoTitle: '卡农 P2 分段讲解', practice: longPractice, submit: longSubmit },
    { objectType: 'track_collection', objectId: trackCollections[1].id, title: '经典指弹入门', practice: longPractice, submit: longSubmit },
    { objectType: 'track_point', objectId: tracks[1].id, title: '晴天', practice: longPractice, submit: longSubmit },
    { objectType: 'knowledge_point', objectId: points[0].id, partId: kpPartIds[points[0].id][0], title: '1645 和弦进行 P1', videoTitle: '1645 和弦进行 P1', practice: longPractice, submit: longSubmit },
    { objectType: 'knowledge_collection', objectId: kpCollections[0].id, title: '指弹基础知识点', practice: longPractice, submit: longSubmit },
    { objectType: 'knowledge_point', objectId: points[1].id, title: '击弦与勾弦', practice: longPractice, submit: longSubmit },
    { objectType: 'track_point', objectId: tracks[2].id, partId: trackPartIds[tracks[2].id][2], title: '稻香 P3 慢速跟练', videoTitle: '稻香 P3 慢速跟练', practice: longPractice, submit: longSubmit }
  ];
  for (let i = 0; i < studentIds.length; i += 1) {
    const adminId = i % 3 === 0 ? teachers.teacher_luxiang : i % 3 === 1 ? teachers.teacher_yuanyuan : teachers.teacher_zhangning;
    for (let day = 7; day >= 0; day -= 1) {
      const count = ((i + day) % 5) + 1;
      const start = (i * 2 + day) % workRows.length;
      const batch = Array.from({ length: count }, (_, offset) => ({
        ...workRows[(start + offset) % workRows.length],
        hour: 9 + (i % 8),
        deleteReason: '老师修改了练习安排，旧记录保留作审计展示。'
      }));
      const deleted = (i === 2 && day === 3) || (i === 10 && day === 5);
      await insertAssignmentBatch(studentIds[i], adminId, day, batch, deleted);
    }
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`测试数据完成：${manifest.ids.users.length} 学员、${manifest.ids.user_assignments.length} 作业记录、${manifest.uploadedKeys.length} 个对象`);
  console.log('账号密码：seed 注入的教导主任、老师、学员测试账号均为 demo123；系统自带超级管理员不由测试数据注入。');
}

main().catch((error) => { console.error('种子脚本执行失败：', error); process.exitCode = 1; }).finally(() => pool.end());
