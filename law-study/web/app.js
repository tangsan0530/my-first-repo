const $ = s => document.querySelector(s);
const esc = v =>
  String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const URL = 'https://ktbmlzkefmchiourjjfc.supabase.co';
const KEY = 'sb_publishable_w_Qapu_FFaM4uvdOUYDMeA_-vDddqp3';

const read = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? d;
  } catch {
    return d;
  }
};
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
const dateShift = (d, n) => {
  const x = new Date(d + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const scorePct = (correct, total = 20) => Math.round((correct / total) * 100);
const dateText = s =>
  new Date(s).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

const names = ['zyl', 'rczy', 'cl'];
const LETTERS = ['A', 'B', 'C', 'D'];
const TYPE_LABEL = { single: '单选题', multiple: '多选题', indefinite: '不定项选择题' };

let lessonData = null;
let practiceBank = null;
let qMap = new Map();
let subjectMap = new Map();
let totalChapters = 0;

let session = read('law-session', null);
let user = session?.username || null;
let tab = 'daily';
let lessonSubject = null;
let lessonChapter = null;
let quiz = null;
let results = null;

let progress = {};
let scores = [];
let queue = [];
let attempts = [];
let filter = '';
let page = 0;
let selectedSet = 1;
let viewMode = 'all';
let syncing = false;
let syncAgain = false;
let cloudError = '';
let busy = false;

const key = n => `law-${user}-${n}`;

function fresh() {
  return { mastery: {}, lessons: {}, days: {}, checkins: [], notes: {}, wrong: [], updated: 0 };
}

function loadUser() {
  progress = { ...fresh(), ...read(key('progress'), {}) };
  progress.lessons ??= {};
  progress.mastery ??= {};
  progress.days ??= {};
  progress.checkins ??= [];
  progress.notes ??= {};
  progress.wrong ??= [];
  queue = read(key('v2-queue'), []);
  attempts = read(key('v2-attempts'), []);
  scores = read(key('v2-scores'), []);
}

function saveProgress() {
  progress.updated = Date.now();
  write(key('progress'), progress);
  scheduleSync();
}

let syncTimer;
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync(), 1200);
}

function activity(kind, amount = 1) {
  const d = today();
  progress.days[d] ??= { cards: 0, answers: 0 };
  progress.days[d][kind] = (progress.days[d][kind] || 0) + amount;
  saveProgress();
}

function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 3500);
}

function normalizeAns(v) {
  const arr = Array.isArray(v) ? v : Number.isInteger(v) && v >= 0 ? [v] : [];
  return [...new Set(arr.filter(x => Number.isInteger(x) && x >= 0 && x <= 3))].sort((a, b) => a - b);
}

function isExactMatch(q, given) {
  const exp = normalizeAns(q.answer);
  const giv = normalizeAns(given);
  return exp.length > 0 && exp.length === giv.length && exp.every((x, i) => x === giv[i]);
}

function formatAns(arr) {
  const a = normalizeAns(arr);
  return a.length ? a.map(x => LETTERS[x]).join('、') : '未作答';
}

async function api(action, body = {}, retry = true) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const r = await fetch(URL + '/functions/v1/law-study-api', {
      method: 'POST',
      headers: {
        apikey: KEY,
        'Content-Type': 'application/json',
        ...(session ? { Authorization: 'Bearer ' + session.access_token } : {})
      },
      body: JSON.stringify({ action, ...body }),
      signal: controller.signal
    });
    const v = await r.json();
    if (r.status === 401 && session && action !== 'login' && retry) {
      const rr = await fetch(URL + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { apikey: KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });
      const token = await rr.json();
      if (!rr.ok) throw Error('登录已过期，请退出后重新登录，离线答卷已保留');
      session = { ...token, username: user };
      write('law-session', session);
      return api(action, body, false);
    }
    if (!r.ok) throw Error(v.error || '请求失败');
    return v;
  } catch (e) {
    if (e.name === 'AbortError') throw Error('连接超时，记录已保存在本机');
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

function mergeProgress(a, b) {
  const out = { ...fresh(), ...a };
  out.checkins = [...new Set([...(a.checkins || []), ...(b.checkins || [])])].sort();
  out.mastery = { ...(a.mastery || {}) };
  for (const [id, m] of Object.entries(b.mastery || {})) {
    if (!out.mastery[id] || m.at > out.mastery[id].at) out.mastery[id] = m;
  }
  out.lessons = { ...(a.lessons || {}) };
  for (const [id, at] of Object.entries(b.lessons || {})) {
    out.lessons[id] = Math.max(out.lessons[id] || 0, at);
  }
  out.notes = { ...(a.notes || {}) };
  for (const [id, n] of Object.entries(b.notes || {})) {
    if (!out.notes[id] || n.at > out.notes[id].at) out.notes[id] = n;
  }
  out.days = { ...(a.days || {}) };
  for (const [d, v] of Object.entries(b.days || {})) {
    const old = out.days[d] || {};
    out.days[d] = {
      cards: Math.max(old.cards || 0, v.cards || 0),
      answers: Math.max(old.answers || 0, v.answers || 0)
    };
  }
  out.wrong = (a.updated || 0) >= (b.updated || 0) ? a.wrong || [] : b.wrong || [];
  out.updated = Math.max(a.updated || 0, b.updated || 0);
  return out;
}

async function sync(pull = true) {
  if (!user || !navigator.onLine || !practiceBank) return;
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  const owner = user;
  cloudError = '';
  try {
    if (pull) {
      const remote = await api('progress-get');
      if (user !== owner) return;
      progress = mergeProgress(progress, remote.data || {});
      write(key('progress'), progress);
    }
    await api('progress-save', { data: progress });
    for (const item of [...queue]) {
      if (user !== owner) return;
      const v = await api('submit', { ...item, version: practiceBank.version });
      const a = attempts.find(x => x.id === item.id);
      if (a) {
        a.synced = true;
        a.correct = v.correct;
      }
      queue = queue.filter(q => q.id !== item.id);
      write(key('v2-queue'), queue);
      write(key('v2-attempts'), attempts);
    }
    const board = await api('scores', { version: practiceBank.version });
    if (user !== owner) return;
    scores = board.scores || [];
    write(key('v2-scores'), scores);
  } catch (e) {
    cloudError = e.message;
  } finally {
    syncing = false;
    if (user === owner && !quiz) render();
    if (syncAgain) {
      syncAgain = false;
      scheduleSync();
    }
  }
}

function icon(n) {
  return ['◉', '▤', '⚑'][n];
}

function shell(content) {
  $('#app').innerHTML =
    '<header><div><span class="mark">法</span><strong>法考同行</strong></div>' +
    '<div class="row"><span class="pill gray">' +
    esc(user) +
    '</span><button class="textbutton" data-action="logout">退出</button></div></header>' +
    '<main>' +
    content +
    '</main><nav class="bottom" aria-label="主导航">' +
    [
      ['daily', '每日打卡'],
      ['study', '章节学习'],
      ['race', '题库竞赛']
    ]
      .map(
        ([id, title], i) =>
          '<button data-tab="' +
          id +
          '" class="' +
          (tab === id ? 'active' : '') +
          '" aria-current="' +
          (tab === id ? 'page' : 'false') +
          '">' +
          icon(i) +
          ' ' +
          title +
          '</button>'
      )
      .join('') +
    '</nav>';
}

function connection() {
  return (
    '<div class="row between"><small>' +
    (navigator.onLine
      ? syncing
        ? '正在同步…'
        : cloudError
          ? '云端待重试'
          : '已连接 · 学习记录保存在本机并同步云端'
      : '当前离线 · 答卷联网后补传') +
    '</small><button class="textbutton" data-action="sync">同步记录' +
    (queue.length ? '（' + queue.length + '份待传）' : '') +
    '</button></div>' +
    (cloudError ? '<div class="notice">' + esc(cloudError) + '</div>' : '')
  );
}

function render() {
  if (!practiceBank || !lessonData) return;
  if (!session || !user) return login();
  if (quiz) return renderQuiz();
  if (results) return renderResults();
  if (tab === 'daily') daily();
  if (tab === 'study') study();
  if (tab === 'race') race();
}

function login(message = '') {
  $('#app').innerHTML =
    '<main class="login stack"><div><div class="eyebrow">每天一点，向前一步</div><h1 class="brand">法考同行</h1><p class="muted">一个人记住规则，三个人坚持更久。</p></div>' +
    '<section class="card"><h2>进入学习小组</h2><p class="muted">使用你的专属账号，继续今天的学习。</p>' +
    '<form id="login-form"><label for="username">用户名</label><input id="username" name="username" placeholder="zyl / rczy / cl" autocomplete="username" autocapitalize="none" required>' +
    '<label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" required>' +
    '<button type="submit">开始学习</button></form>' +
    (message ? '<div class="error" role="alert">' + esc(message) + '</div>' : '') +
    '</section><div class="notice">苹果手机：用 Safari 打开本链接，点“分享”，选择“添加到主屏幕”。首次联网加载完成后，可离线查看已缓存内容；首次登录与成绩共享需要联网。</div>' +
    '<small>当前题库：' +
    practiceBank.questions.length +
    ' 道原创题（' +
    practiceBank.papers.length +
    ' 套 × 20 题）· ' +
    lessonData.subjects.length +
    ' 个科目 / ' +
    totalChapters +
    ' 章系统教材（学习草稿，尚未经过法律专业人工逐题审校）。</small></main>';
}

function streak() {
  let n = 0;
  let d = today();
  if (!progress.checkins.includes(d)) d = dateShift(d, -1);
  while (progress.checkins.includes(d)) {
    n++;
    d = dateShift(d, -1);
  }
  return n;
}

function daily() {
  const day = progress.days[today()] || { cards: 0, answers: 0 };
  const done = progress.checkins.includes(today());
  const due = practiceBank.questions.filter(q => progress.mastery[q.id]?.due <= today()).length;
  const studiedChapters = Object.keys(progress.lessons || {}).length;
  const completedPapers = new Set(attempts.map(a => a.set_id)).size;

  shell(
    '<div class="stack">' +
      connection() +
      '<section class="card hero"><div class="eyebrow">今日学习 / ' +
      today().replaceAll('-', '.') +
      '</div><div class="row between"><div><h1>' +
      esc(user) +
      '，一起把今天学扎实</h1><p class="muted">记规则，辨例外，再用题目检验理解。</p></div><div><div class="hero-number">' +
      streak() +
      '<span style="font-size:20px;letter-spacing:0"> 天</span></div><small class="muted">连续打卡</small></div></div>' +
      '<div class="bar"><span style="width:' +
      Math.min(100, ((Math.min(day.cards, 2) / 2 + Math.min(day.answers, 10) / 10) / 2) * 100) +
      '%"></span></div>' +
      '<div class="row between"><span>章节/复习 ' +
      day.cards +
      '/2　·　答题 ' +
      day.answers +
      '/10</span><button data-action="checkin" ' +
      (done || day.cards < 2 || day.answers < 10 ? 'disabled' : '') +
      '>' +
      (done ? '今日已打卡' : '完成目标后打卡') +
      '</button></div></section>' +
      '<div class="grid stats-grid"><div class="card"><small>已学章节</small><div class="stat">' +
      studiedChapters +
      ' <small>/ ' +
      totalChapters +
      '</small></div></div><div class="card"><small>已练套卷</small><div class="stat">' +
      completedPapers +
      ' <small>/ ' +
      practiceBank.papers.length +
      '</small></div></div><div class="card"><small>待复习题</small><div class="stat">' +
      due +
      '</div></div></div>' +
      '<section class="card"><h2>留下一周的脚印</h2><div class="week">' +
      Array.from({ length: 7 }, (_, i) => {
        const d = dateShift(today(), i - 6);
        return (
          '<div class="day ' +
          (progress.checkins.includes(d) ? 'done ' : '') +
          (d === today() ? 'today' : '') +
          '"><small>' +
          d.slice(5).replace('-', '/') +
          '</small><strong>' +
          (progress.checkins.includes(d) ? '已打卡' : d === today() ? '今天' : '待积累') +
          '</strong></div>'
        );
      }).join('') +
      '</div></section>' +
      '<div class="grid two"><section class="card"><span class="pill">系统精讲</span><h2 style="margin-top:14px">按法考大纲分章学习</h2><p class="muted">覆盖 ' +
      lessonData.subjects.length +
      ' 个科目、' +
      totalChapters +
      ' 章知识点、易错点、案例与随堂练习，支持个人笔记与错题巩固。</p><button data-tab="study">继续章节学习</button></section>' +
      '<section class="card"><span class="pill">组队坚持</span><h2 style="margin-top:14px">一起完成一套挑战</h2><p class="muted">50 套不重复原创题，每套 20 题，支持单选/多选/不定项与三人成绩对比。</p><button data-tab="race">进入题库竞赛</button></section></div>' +
      '<details class="card"><summary>安装到手机与题库说明</summary><div><p>iPhone：请从微信选择“在 Safari 中打开”，再使用分享菜单中的“添加到主屏幕”。本应用不要求苹果开发者账号。</p><p>Android：可使用本应用安装包（APK）或浏览器添加到主屏幕。</p><p>本应用内置 ' +
      lessonData.subjects.length +
      ' 科 ' +
      totalChapters +
      ' 章系统学习资料与 ' +
      practiceBank.questions.length +
      ' 道原创题（50 套 × 20 题，不重复）。题库与讲义为学习草稿，尚未经过法律专业机构逐题审校，请结合最新法律法规及官方大纲使用。</p><p>分数按答对题数 / 20 × 100 四舍五入（多选与不定项需完全匹配）；成绩可被本学习组三人查看，学习笔记仅本人查看。</p><button data-action="export" class="quiet">导出本人学习备份</button></div></details></div>'
  );
}

function study() {
  const subjects = lessonData.subjects;
  const subject = subjects.find(x => x.id === lessonSubject);
  const chapter = subject?.chapters.find(x => x.id === lessonChapter);
  const done = progress.lessons || {};
  const dueCount = practiceBank.questions.filter(q => progress.mastery[q.id]?.due <= today()).length;

  if (!subject) {
    shell(
      '<div class="stack">' +
        connection() +
        '<div class="sectionhead"><div><div class="eyebrow">LEARN / 先理解，再记忆</div><h1>系统章节学习</h1><p class="muted">' +
        subjects.length +
        ' 个科目 · ' +
        totalChapters +
        ' 章完整路径</p></div></div>' +
        '<div class="row"><button class="quiet" data-action="due">到期复习（' +
        dueCount +
        '）</button><button class="quiet" data-action="wrong">错题巩固（' +
        progress.wrong.length +
        '）</button></div>' +
        '<div class="notice">本内容覆盖法考大纲全部 ' +
        subjects.length +
        ' 个科目（学习草稿），具体规则请结合所引法条及最新官方大纲学习。</div>' +
        '<div class="grid">' +
        subjects
          .map((s, idx) => {
            const doneNum = s.chapters.filter(c => done[c.id]).length;
            const pct = s.chapters.length ? Math.round((doneNum / s.chapters.length) * 100) : 0;
            return (
              '<section class="card subject"><span class="index">科目 ' +
              String(idx + 1).padStart(2, '0') +
              '</span><h3>' +
              esc(s.title) +
              '</h3><small>' +
              doneNum +
              ' / ' +
              s.chapters.length +
              ' 章已完成</small><div class="bar"><span style="width:' +
              pct +
              '%"></span></div><button class="quiet" data-lesson-subject="' +
              s.id +
              '">' +
              (doneNum ? '继续学习' : '开始学习') +
              '</button></section>'
            );
          })
          .join('') +
        '</div></div>'
    );
    return;
  }

  if (!chapter) {
    const doneNum = subject.chapters.filter(c => done[c.id]).length;
    shell(
      '<div class="stack">' +
        connection() +
        '<div class="row between"><button class="quiet" data-lesson-back>返回科目列表</button><span class="pill">' +
        doneNum +
        ' / ' +
        subject.chapters.length +
        ' 章已学</span></div>' +
        '<h1>' +
        esc(subject.title) +
        '</h1>' +
        '<div class="grid">' +
        subject.chapters
          .map((c, i) => {
            const linkedQs = practiceBank.questions.filter(q => q.chapter === c.id).length;
            return (
              '<section class="card subject"><small>第 ' +
              (i + 1) +
              ' 章 ' +
              (done[c.id] ? '· <span style="color:var(--green)">已学</span>' : '') +
              '</small><h3>' +
              esc(c.title) +
              '</h3><small class="muted">' +
              (linkedQs ? '含 ' + linkedQs + ' 道随堂练习' : '精讲章节') +
              '</small><button class="quiet" data-lesson-chapter="' +
              esc(c.id) +
              '">学习本章</button></section>'
            );
          })
          .join('') +
        '</div></div>'
    );
    return;
  }

  const chQs = practiceBank.questions.filter(q => q.chapter === chapter.id);
  const note = progress.notes[chapter.id]?.text || '';
  const objs = (chapter.objectives || []).map(o => '<li>' + esc(o) + '</li>').join('');
  const sections = (chapter.sections || [])
    .map(s => '<section class="card"><h2>' + esc(s.title) + '</h2><p>' + esc(s.body) + '</p></section>')
    .join('');
  const pitfalls = (chapter.pitfalls || []).map(p => '<li>' + esc(p) + '</li>').join('');
  const refs = (chapter.sourceRefs || [])
    .map(
      r =>
        '<li><a href="' +
        esc(r.url) +
        '" target="_blank" rel="noopener noreferrer">' +
        esc(r.title) +
        ' ' +
        esc(r.article || '') +
        '</a></li>'
    )
    .join('');

  const chIdx = subject.chapters.findIndex(c => c.id === chapter.id);
  const prevCh = chIdx > 0 ? subject.chapters[chIdx - 1] : null;
  const nextCh = chIdx < subject.chapters.length - 1 ? subject.chapters[chIdx + 1] : null;

  shell(
    '<div class="stack">' +
      connection() +
      '<div class="row between"><button class="quiet" data-lesson-back>返回章节列表</button><span class="pill">' +
      esc(subject.title) +
      ' · ' +
      (chIdx + 1) +
      '/' +
      subject.chapters.length +
      '</span></div>' +
      '<h1>' +
      esc(chapter.title) +
      '</h1>' +
      (objs ? '<section class="card"><h2>学习目标</h2><ul>' + objs + '</ul></section>' : '') +
      sections +
      '<section class="card"><h2>易错点提示</h2><ul>' +
      pitfalls +
      '</ul></section>' +
      (chapter.caseStudy
        ? '<section class="card"><h2>案例理解</h2><p><b>案情：</b>' +
          esc(chapter.caseStudy.facts) +
          '</p><p><b>分析：</b>' +
          esc(chapter.caseStudy.analysis) +
          '</p></section>'
        : '') +
      '<section class="card"><h2>答题方法与法条依据</h2><p>' +
      esc(chapter.method || '') +
      '</p><h3>法条来源</h3><ul>' +
      refs +
      '</ul><div class="row" style="margin-top:16px"><button data-lesson-done="' +
      esc(chapter.id) +
      '">' +
      (done[chapter.id] ? '已标记完成 · 再次巩固' : '完成本章并打卡') +
      '</button>' +
      (chQs.length
        ? '<button class="outline" data-chapter-practice="' + esc(chapter.id) + '">做本章随堂练习（' + chQs.length + '题）</button>'
        : '') +
      '</div></section>' +
      '<section class="card"><h3>本章个人笔记</h3><textarea id="note" placeholder="记下你自己的口诀、法条对比或易错点，仅自己可见。">' +
      esc(note) +
      '</textarea><div class="row between" style="margin-top:12px"><small class="muted">保存后将同步云端</small><button class="quiet" data-note="' +
      esc(chapter.id) +
      '">保存笔记</button></div></section>' +
      '<div class="quiznav">' +
      (prevCh ? '<button class="quiet" data-lesson-chapter="' + esc(prevCh.id) + '">上一章</button>' : '<span></span>') +
      (nextCh ? '<button class="quiet" data-lesson-chapter="' + esc(nextCh.id) + '">下一章</button>' : '<span></span>') +
      '</div></div>'
  );
}

function summary(name, setId) {
  const a = scores
    .filter(s => s.username === name && s.set_id === setId)
    .sort((x, y) => x.created_at.localeCompare(y.created_at) || x.id.localeCompare(y.id));
  return a.length ? { first: a[0], last: a.at(-1), best: Math.max(...a.map(x => x.correct)), count: a.length } : null;
}

function race() {
  const all = practiceBank.papers.filter(s => !filter || String(s.id).includes(filter) || s.title.includes(filter));
  const shown = all.filter(s => viewMode === 'all' || (viewMode === 'done') === attempts.some(a => a.set_id === s.id));
  const pages = Math.ceil(shown.length / 15);
  page = Math.min(page, Math.max(0, pages - 1));
  const selected = practiceBank.papers.find(p => p.id === selectedSet) || practiceBank.papers[0];

  shell(
    '<div class="stack">' +
      connection() +
      '<section class="card hero"><div class="eyebrow">CHALLENGE / 同一份题，一起进步</div><h1>题库竞赛</h1><p class="muted">' +
      practiceBank.papers.length +
      ' 套不重复原创题，每套 20 题（共 ' +
      practiceBank.questions.length +
      ' 题）。含单选、多选与不定项，每套题三人一致。</p><span class="pill">首次成绩 · 最高成绩 · 最近成绩</span></section>' +
      '<section class="card"><div class="row between"><h2>' +
      esc(selected.title) +
      '</h2><button data-start="' +
      selected.id +
      '">开始本套 · 20 题</button></div>' +
      '<div class="tablewrap"><table><thead><tr><th>伙伴</th><th>首次</th><th>最高</th><th>最近</th><th>次数</th></tr></thead><tbody>' +
      names
        .map(n => {
          const s = summary(n, selected.id);
          return (
            '<tr><td><strong>' +
            n +
            '</strong>' +
            (n === user ? ' <small>我</small>' : '') +
            '</td><td>' +
            (s ? scorePct(s.first.correct, 20) : '—') +
            '</td><td>' +
            (s ? scorePct(s.best, 20) : '—') +
            '</td><td>' +
            (s ? scorePct(s.last.correct, 20) : '—') +
            '</td><td>' +
            (s ? s.count : 0) +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div><small>成绩为百分制（精确匹配计分）；“—”表示尚无已上传答卷。离线成绩补传后显示。' +
      (!navigator.onLine ? ' 当前显示上次同步的缓存。' : '') +
      '</small></section>' +
      '<section class="card"><div class="sectionhead" style="margin-top:0"><h2>选择一套训练</h2><span class="muted">' +
      shown.length +
      ' 套</span></div>' +
      '<div class="filters"><input id="set-filter" aria-label="搜索套题" placeholder="搜索套题编号或名称" value="' +
      esc(filter) +
      '"><select id="set-view" aria-label="筛选完成状态"><option value="all" ' +
      (viewMode === 'all' ? 'selected' : '') +
      '>全部题库</option><option value="todo" ' +
      (viewMode === 'todo' ? 'selected' : '') +
      '>尚未完成</option><option value="done" ' +
      (viewMode === 'done' ? 'selected' : '') +
      '>已经完成</option></select></div>' +
      '<div class="spacer"></div><div class="sets">' +
      shown
        .slice(page * 15, page * 15 + 15)
        .map(s => {
          const mine = attempts.filter(a => a.set_id === s.id);
          return (
            '<button class="setbtn ' +
            (mine.length ? 'done ' : '') +
            (s.id === selected.id ? 'selected' : '') +
            '" data-select="' +
            s.id +
            '"><strong>' +
            String(s.id).padStart(2, '0') +
            '</strong><small>' +
            (mine.length ? '最高 ' + scorePct(Math.max(...mine.map(x => x.correct)), 20) + ' 分' : '20 题 · 未完成') +
            '</small></button>'
          );
        })
        .join('') +
      '</div>' +
      (!shown.length ? '<div class="empty">没有符合条件的题库</div>' : '') +
      '<div class="quiznav"><button class="quiet" data-page="-1" ' +
      (!page ? 'disabled' : '') +
      '>上一页</button><small>' +
      (pages ? page + 1 : 0) +
      ' / ' +
      pages +
      '</small><button class="quiet" data-page="1" ' +
      (page >= pages - 1 ? 'disabled' : '') +
      '>下一页</button></div></section>' +
      '<section class="card"><h2>我的最近答卷</h2>' +
      attempts
        .slice()
        .reverse()
        .slice(0, 6)
        .map(
          a =>
            '<div class="row between review"><span>第 ' +
            String(a.set_id).padStart(2, '0') +
            ' 套 · ' +
            scorePct(a.correct, a.ids.length) +
            ' 分（' +
            a.correct +
            '/' +
            a.ids.length +
            '）<br><small>' +
            dateText(a.ended) +
            ' · ' +
            (a.synced ? '已上传' : '等待补传') +
            '</small></span><button class="quiet tiny" data-result="' +
            a.id +
            '">查看解析</button></div>'
        )
        .join('') +
      (attempts.length ? '' : '<p class="muted">完成第一套后，答卷会保存在这里。</p>') +
      '</section></div>'
  );
}

function begin(ids, mode = 'practice', setId = null) {
  if (mode === 'race') {
    const draft = read(key('v2-draft-' + setId), null);
    if (draft && draft.version === practiceBank.version && confirm('发现这套题上次未完成的答卷，要继续吗？')) {
      quiz = draft;
      render();
      return;
    }
  }
  quiz = {
    ids,
    mode,
    set_id: setId,
    index: 0,
    answers: ids.map(() => []),
    revealed: false,
    started: Date.now(),
    id: crypto.randomUUID(),
    version: practiceBank.version
  };
  results = null;
  persistQuiz();
  render();
}

function persistQuiz() {
  if (quiz?.mode === 'race') write(key('v2-draft-' + quiz.set_id), quiz);
}

function elapsed() {
  const n = Math.floor((Date.now() - quiz.started) / 1000);
  return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
}

function renderQuiz() {
  const q = qMap.get(quiz.ids[quiz.index]);
  const chosen = normalizeAns(quiz.answers[quiz.index]);
  const show = quiz.mode !== 'race' && quiz.revealed;
  const ok = show ? isExactMatch(q, chosen) : false;
  const subTitle = subjectMap.get(q.subject)?.title || '法考综合';

  $('#app').innerHTML =
    '<header class="quiz-header"><button class="textbutton" data-action="leave-quiz">保存并返回</button><strong>' +
    (quiz.mode === 'race' ? '第 ' + String(quiz.set_id).padStart(2, '0') + ' 套竞赛' : '随堂巩固') +
    '</strong><span class="timer" id="timer">' +
    elapsed() +
    '</span></header><main><section class="card"><div class="row between"><div class="row"><span class="pill">' +
    esc(subTitle) +
    '</span><span class="pill gray">' +
    esc(TYPE_LABEL[q.type] || '选择题') +
    '</span></div><small>' +
    (quiz.index + 1) +
    ' / ' +
    quiz.ids.length +
    '</small></div><div class="bar"><span style="width:' +
    ((quiz.index + 1) / quiz.ids.length) * 100 +
    '%"></span></div><p class="qtitle">' +
    esc(q.prompt) +
    '</p>' +
    '<div class="options">' +
    q.options
      .map((o, i) => {
        const isChosen = chosen.includes(i);
        const isRight = q.answer.includes(i);
        const cls = show ? (isRight ? 'right ' : isChosen ? 'wrong ' : '') : '';
        return (
          '<button class="option ' +
          (isChosen ? 'chosen ' : '') +
          cls +
          '" data-answer="' +
          i +
          '" ' +
          (show ? 'disabled' : '') +
          '><span class="letter">' +
          LETTERS[i] +
          '</span><span>' +
          esc(o) +
          '</span></button>'
        );
      })
      .join('') +
    '</div>' +
    (show
      ? '<div class="' +
        (ok ? 'success' : 'notice') +
        '"><strong>' +
        (ok ? '回答正确' : '再仔细辨析') +
        '</strong><p>正确答案：' +
        formatAns(q.answer) +
        '</p><p>' +
        esc(q.explanation) +
        '</p><ul>' +
        (q.optionAnalysis || []).map((x, j) => '<li>' + LETTERS[j] + '：' + esc(x) + '</li>').join('') +
        '</ul>' +
        (q.basis || [])
          .map(
            b =>
              '<a href="' +
              esc(b.url) +
              '" target="_blank" rel="noopener noreferrer">' +
              esc(b.title + ' ' + (b.article || '')) +
              '</a>'
          )
          .join(' ') +
        '</div>'
      : '') +
    '<div class="quiznav"><button class="quiet" data-action="prev-q" ' +
    (!quiz.index ? 'disabled' : '') +
    '>上一题</button>' +
    (quiz.mode !== 'race' && !show
      ? '<button data-action="reveal" ' + (!chosen.length ? 'disabled' : '') + '>核对答案</button>'
      : '<button data-action="' +
        (quiz.index === quiz.ids.length - 1 ? 'finish' : 'next-q') +
        '">' +
        (quiz.index === quiz.ids.length - 1 ? '提交答卷' : '下一题') +
        '</button>') +
    '</div></section>' +
    (quiz.mode === 'race'
      ? '<section class="card" style="margin-top:18px"><div class="row between"><strong>答题卡</strong><small>已答 ' +
        quiz.answers.filter(a => a.length > 0).length +
        ' / ' +
        quiz.ids.length +
        '</small></div><div class="navigator">' +
        quiz.ids
          .map(
            (_, i) =>
              '<button data-qindex="' +
              i +
              '" class="' +
              (quiz.answers[i].length ? 'answered ' : '') +
              (quiz.index === i ? 'current' : '') +
              '">' +
              (i + 1) +
              '</button>'
          )
          .join('') +
        '</div><button class="full" style="margin-top:18px" data-action="finish">提交答卷</button></section>'
      : '') +
    '</main>';
}

function markWrong(q, correct) {
  const set = new Set(progress.wrong || []);
  if (correct) set.delete(q.id);
  else set.add(q.id);
  progress.wrong = [...set];
}

function scheduleReview(qid, ok) {
  const old = progress.mastery[qid];
  const level = ok ? Math.min(4, (old?.level || 0) + 1) : 0;
  const interval = [1, 1, 3, 7, 14][level];
  progress.mastery[qid] = { level, due: dateShift(today(), interval), at: Date.now() };
}

async function finish() {
  if (busy) return;
  const missing = quiz.answers.filter(a => !a.length).length;
  if (missing && !confirm('还有 ' + missing + ' 道未作答，未答题按错误计分。确认提交？')) return;
  busy = true;
  const run = quiz;
  const correct = run.ids.reduce((n, id, i) => {
    const q = qMap.get(id);
    const ok = isExactMatch(q, run.answers[i]);
    markWrong(q, ok);
    scheduleReview(id, ok);
    return n + (ok ? 1 : 0);
  }, 0);

  if (run.mode === 'race') activity('answers', run.ids.length);
  results = { ...run, correct, ended: new Date().toISOString(), synced: false };

  if (run.mode === 'race') {
    attempts.push(results);
    if (!queue.some(item => item.id === run.id)) {
      queue.push({ id: run.id, set_id: run.set_id, answers: run.answers });
    }
    write(key('v2-attempts'), attempts);
    write(key('v2-queue'), queue);
    localStorage.removeItem(key('v2-draft-' + run.set_id));
  }
  saveProgress();
  quiz = null;
  busy = false;
  renderResults();
  sync();
}

function renderResults() {
  const r = results;
  const pct = scorePct(r.correct, r.ids.length);
  const synced = r.mode === 'race' ? attempts.find(a => a.id === r.id)?.synced : false;

  shell(
    '<div class="stack"><section class="card" style="text-align:center"><span class="pill">' +
      (r.mode === 'race' ? '第 ' + String(r.set_id).padStart(2, '0') + ' 套已完成' : '巩固已完成') +
      '</span><h1 style="margin-top:20px">' +
      (pct >= 80 ? '稳稳向前，再接再厉' : '看清易错点，就是进步') +
      '</h1><div class="score">' +
      pct +
      '<span style="font-size:20px"> 分</span></div><p>' +
      r.correct +
      ' / ' +
      r.ids.length +
      ' 题正确</p><p class="muted">' +
      (r.mode === 'race'
        ? synced
          ? '已上传云端，伙伴可查看成绩'
          : '答卷已保存本机，正在等待云端确认'
        : '本次为随堂练习，不计入套题竞赛成绩') +
      '</p><div class="row" style="justify-content:center"><button data-action="close-results">返回学习</button><button class="quiet" data-action="retry-wrong">再练本次错题</button></div></section>' +
      '<section class="card"><h2>逐题复盘</h2>' +
      r.ids
        .map((id, i) => {
          const q = qMap.get(id);
          const given = r.answers[i];
          const ok = isExactMatch(q, given);
          return (
            '<details class="review"><summary><span style="color:' +
            (ok ? 'var(--green)' : 'var(--red)') +
            '">' +
            (ok ? '正确' : '待巩固') +
            '</span> · ' +
            (i + 1) +
            '. [' +
            esc(TYPE_LABEL[q.type] || '选择') +
            '] ' +
            esc(q.prompt) +
            '</summary><div><p>你的选择：' +
            formatAns(given) +
            '</p><p>正确答案：' +
            formatAns(q.answer) +
            '</p><p>' +
            esc(q.explanation) +
            '</p><ul>' +
            (q.optionAnalysis || []).map((x, j) => '<li>' + LETTERS[j] + '：' + esc(x) + '</li>').join('') +
            '</ul>' +
            (q.basis || [])
              .map(
                b =>
                  '<a href="' +
                  esc(b.url) +
                  '" target="_blank" rel="noopener noreferrer">' +
                  esc(b.title + ' ' + (b.article || '')) +
                  '</a>'
              )
              .join(' ') +
            '</div></details>'
          );
        })
        .join('') +
      '</section></div>'
  );
}

document.addEventListener('submit', async e => {
  if (e.target.id !== 'login-form') return;
  e.preventDefault();
  const form = e.target;
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = '正在登录…';
  try {
    const v = await api('login', { username: form.username.value.trim(), password: form.password.value });
    user = v.username;
    session = { ...v.session, username: user };
    write('law-session', session);
    loadUser();
    render();
    sync();
  } catch (err) {
    login(err.message);
  }
});

document.addEventListener('change', e => {
  if (e.target.id === 'set-view') {
    viewMode = e.target.value;
    page = 0;
    race();
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'set-filter') {
    filter = e.target.value;
    page = 0;
    const start = e.target.selectionStart;
    race();
    $('#set-filter').focus();
    $('#set-filter').setSelectionRange(start, start);
  }
});

document.addEventListener('click', async e => {
  const el = e.target.closest('button');
  if (!el || el.disabled) return;
  const d = el.dataset;

  if (d.tab) {
    if (quiz && !confirm('返回模块会保留竞赛草稿，确定离开？')) return;
    quiz = null;
    results = null;
    tab = d.tab;
    if (tab !== 'study') {
      lessonSubject = null;
      lessonChapter = null;
    }
    render();
    return;
  }

  if (d.lessonSubject !== undefined) {
    lessonSubject = Number(d.lessonSubject);
    lessonChapter = null;
    study();
    return;
  }
  if (d.lessonChapter !== undefined) {
    lessonChapter = d.lessonChapter;
    study();
    return;
  }
  if (d.lessonBack !== undefined) {
    if (lessonChapter) lessonChapter = null;
    else if (lessonSubject !== null) lessonSubject = null;
    study();
    return;
  }
  if (d.lessonDone !== undefined) {
    progress.lessons ??= {};
    progress.lessons[d.lessonDone] = Date.now();
    activity('cards', 1);
    toast('已记录章节学习进度');
    study();
    return;
  }
  if (d.chapterPractice !== undefined) {
    const ids = practiceBank.questions.filter(q => q.chapter === d.chapterPractice).map(q => q.id);
    if (ids.length) begin(ids, 'practice');
    else toast('本章暂无随堂题目');
    return;
  }

  if (d.note) {
    progress.notes[d.note] = { text: $('#note').value.slice(0, 5000), at: Date.now() };
    saveProgress();
    toast('笔记已保存在本机，将同步云端');
    return;
  }

  if (d.select) {
    selectedSet = Number(d.select);
    race();
    return;
  }
  if (d.start) {
    const s = practiceBank.papers.find(p => p.id === Number(d.start));
    if (s) begin(s.questions, 'race', s.id);
    return;
  }
  if (d.page) {
    page += Number(d.page);
    race();
    return;
  }
  if (d.result) {
    const a = attempts.find(x => x.id === d.result);
    if (a) {
      results = a;
      render();
    }
    return;
  }
  if (d.answer !== undefined) {
    const q = qMap.get(quiz.ids[quiz.index]);
    const v = Number(d.answer);
    const cur = normalizeAns(quiz.answers[quiz.index]);
    quiz.answers[quiz.index] =
      q.type === 'single' ? [v] : cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v].sort((a, b) => a - b);
    persistQuiz();
    renderQuiz();
    return;
  }
  if (d.qindex !== undefined) {
    quiz.index = Number(d.qindex);
    quiz.revealed = false;
    persistQuiz();
    renderQuiz();
    return;
  }

  switch (d.action) {
    case 'logout':
      if (syncing) {
        toast('正在同步，请稍后退出');
        return;
      }
      if (queue.length && !confirm('仍有未上传答卷，退出后本机保留，重新登录同一账号可补传。确定退出？')) return;
      clearTimeout(syncTimer);
      session = null;
      user = null;
      quiz = null;
      results = null;
      lessonSubject = null;
      lessonChapter = null;
      progress = fresh();
      scores = [];
      queue = [];
      attempts = [];
      localStorage.removeItem('law-session');
      login();
      break;
    case 'sync':
      await sync();
      if (results) renderResults();
      toast(cloudError || '同步完成');
      break;
    case 'checkin': {
      const day = progress.days[today()] || {};
      if ((day.cards || 0) >= 2 && (day.answers || 0) >= 10 && !progress.checkins.includes(today())) {
        progress.checkins.push(today());
        saveProgress();
        render();
        toast('今天的努力，已记下。');
      }
      break;
    }
    case 'due': {
      const ids = practiceBank.questions.filter(q => progress.mastery[q.id]?.due <= today()).map(q => q.id);
      ids.length ? begin(ids.slice(0, 20), 'practice') : toast('还没有到期知识点，可以先学新章节');
      break;
    }
    case 'wrong': {
      const ids = (progress.wrong || []).filter(id => qMap.has(id));
      ids.length ? begin(ids.slice(0, 20), 'practice') : toast('错题本为空，先完成一次练习');
      break;
    }
    case 'prev-q':
      quiz.index--;
      quiz.revealed = false;
      persistQuiz();
      renderQuiz();
      break;
    case 'next-q':
      quiz.index++;
      quiz.revealed = false;
      persistQuiz();
      renderQuiz();
      break;
    case 'reveal': {
      const q = qMap.get(quiz.ids[quiz.index]);
      quiz.revealed = true;
      const ok = isExactMatch(q, quiz.answers[quiz.index]);
      markWrong(q, ok);
      scheduleReview(q.id, ok);
      activity('answers', 1);
      renderQuiz();
      break;
    }
    case 'finish':
      await finish();
      break;
    case 'leave-quiz':
      persistQuiz();
      quiz = null;
      render();
      break;
    case 'close-results':
      results = null;
      render();
      break;
    case 'retry-wrong': {
      const ids = results.ids.filter((id, i) => !isExactMatch(qMap.get(id), results.answers[i]));
      ids.length ? begin(ids, 'practice') : toast('本次全部答对了，可以开始下一套');
      break;
    }
    case 'export': {
      const blob = new Blob(
        [JSON.stringify({ version: practiceBank.version, username: user, progress, attempts, pending: queue }, null, 2)],
        { type: 'application/json' }
      );
      const a = document.createElement('a');
      a.href = window.URL.createObjectURL(blob);
      a.download = '法考同行_' + user + '_' + today() + '.json';
      a.click();
      setTimeout(() => window.URL.revokeObjectURL(a.href), 1000);
      break;
    }
  }
});

window.addEventListener('online', () => {
  toast('网络已恢复，正在补传记录');
  sync();
});
window.addEventListener('offline', () => {
  if (!quiz && !results) render();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && user) sync();
});
setInterval(() => {
  if (quiz && $('#timer')) $('#timer').textContent = elapsed();
}, 1000);

try {
  const [pr, lr] = await Promise.all([fetch('./practice.json'), fetch('./lessons.json')]);
  if (!pr.ok || !lr.ok) throw Error('题库或章节加载失败');
  practiceBank = await pr.json();
  lessonData = await lr.json();
  qMap = new Map(practiceBank.questions.map(q => [q.id, q]));
  subjectMap = new Map(lessonData.subjects.map(s => [s.id, s]));
  totalChapters = lessonData.subjects.reduce((n, s) => n + s.chapters.length, 0);
  if (user) loadUser();
  render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('./sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(() => toast('离线学习缓存已准备'))
      .catch(() => {});
  }
  if (user) sync();
} catch (e) {
  $('#app').innerHTML =
    '<main><h1>暂时无法加载学习内容</h1><p>' +
    esc(e.message) +
    '</p><button onclick="location.reload()">重新加载</button></main>';
}
