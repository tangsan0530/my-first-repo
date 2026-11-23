const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const URL='https://ktbmlzkefmchiourjjfc.supabase.co',KEY='sb_publishable_w_Qapu_FFaM4uvdOUYDMeA_-vDddqp3';
const read=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}};
const write=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
const dateShift=(d,n)=>{let x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
const score=n=>Math.round(n/30*100);
const dateText=s=>new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
const names=['zyl','rczy','cl'];
let bank,session=read('law-session',null),user=session?.username,tab='daily',chapter=null,cardIndex=0,flipped=false,quiz=null,results=null;
let progress={},scores=[],queue=[],attempts=[],filter='',page=0,selectedSet=1,viewMode='all',syncing=false,cloudError='',busy=false;
const key=n=>'law-'+user+'-'+n;
function fresh(){return{mastery:{},days:{},checkins:[],notes:{},wrong:[],updated:0}}
function loadUser(){progress={...fresh(),...read(key('progress'),{})};queue=read(key('queue'),[]);attempts=read(key('attempts'),[]);scores=read(key('scores'),[])}
function saveProgress(){progress.updated=Date.now();write(key('progress'),progress);scheduleSync()}
let syncTimer;
function scheduleSync(){clearTimeout(syncTimer);syncTimer=setTimeout(()=>sync(),1200)}
function activity(kind,amount=1){const d=today();progress.days[d]??={cards:0,answers:0};progress.days[d][kind]=(progress.days[d][kind]||0)+amount;saveProgress()}
function toast(msg){$('#toast').textContent=msg;$('#toast').classList.add('visible');setTimeout(()=>$('#toast').classList.remove('visible'),3500)}
async function api(action,body={},retry=true){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),18000);
 try{
 const r=await fetch(URL+'/functions/v1/law-study-api',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.access_token}:{})},body:JSON.stringify({action,...body}),signal:controller.signal});
 const v=await r.json();
 if(r.status===401&&session&&action!=='login'&&retry){
  const rr=await fetch(URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});
  const token=await rr.json();if(!rr.ok)throw Error('登录已过期，请退出后重新登录，离线答卷已保留');
  session={...token,username:user};write('law-session',session);return api(action,body,false);
 }
 if(!r.ok)throw Error(v.error||'请求失败');return v;
 }catch(e){if(e.name==='AbortError')throw Error('连接超时，记录已保存在本机');throw e}
 finally{clearTimeout(timeout)}
}
function mergeProgress(a,b){
 const out={...fresh(),...a};
 out.checkins=[...new Set([...(a.checkins||[]),...(b.checkins||[])])].sort();
 out.mastery={...a.mastery};
 for(const[id,m]of Object.entries(b.mastery||{}))if(!out.mastery[id]||m.at>out.mastery[id].at)out.mastery[id]=m;
 out.notes={...a.notes};
 for(const[id,n]of Object.entries(b.notes||{}))if(!out.notes[id]||n.at>out.notes[id].at)out.notes[id]=n;
 out.days={...a.days};
 for(const[d,v]of Object.entries(b.days||{})){const old=out.days[d]||{};out.days[d]={cards:Math.max(old.cards||0,v.cards||0),answers:Math.max(old.answers||0,v.answers||0)}}
 // Wrong-question membership follows the more recently edited local/remote snapshot.
 out.wrong=(a.updated||0)>=(b.updated||0)?(a.wrong||[]):(b.wrong||[]);
 out.updated=Math.max(a.updated||0,b.updated||0);return out;
}
async function sync(pull=true){
 if(!user||syncing||!navigator.onLine)return;
 syncing=true;const owner=user;cloudError='';
 try{
  if(pull){const remote=await api('progress-get');if(user!==owner)return;progress=mergeProgress(progress,remote.data);write(key('progress'),progress)}
  await api('progress-save',{data:progress});
  for(const item of [...queue]){
   if(user!==owner)return;
   const v=await api('submit',item);const a=attempts.find(a=>a.id===item.id);if(a){a.synced=true;a.correct=v.correct}
   queue=queue.filter(q=>q.id!==item.id);write(key('queue'),queue);write(key('attempts'),attempts);
  }
  const board=await api('scores');if(user!==owner)return;scores=board.scores;write(key('scores'),scores);
 }catch(e){cloudError=e.message}
 finally{syncing=false;if(user===owner&&!quiz&&!results)render()}
}
function icon(n){return ['◉','▤','⚑'][n]}
function shell(content){
 $('#app').innerHTML='<header><div><span class="mark">法</span><strong>法考同行</strong> <small>三人学习小组</small></div><div class="row"><span class="pill gray">'+esc(user)+'</span><button class="textbutton" data-action="logout">退出</button></div></header><main>'+content+'</main><nav class="bottom" aria-label="主导航">'+[['daily','每日打卡'],['study','章节学习'],['race','题库竞赛']].map(([id,title],i)=>'<button data-tab="'+id+'" class="'+(tab===id?'active':'')+'" aria-current="'+(tab===id?'page':'false')+'">'+icon(i)+' '+title+'</button>').join('')+'</nav>';
}
function connection(){return '<div class="row between"><small>'+(navigator.onLine?(syncing?'正在同步…':cloudError?'云端待重试':'已连接 · 学习记录保存在本机并同步云端'):'当前离线 · 答卷联网后补传')+'</small><button class="textbutton" data-action="sync">同步记录'+(queue.length?'（'+queue.length+'份待传）':'')+'</button></div>'+(cloudError?'<div class="notice">'+esc(cloudError)+'</div>':'')}
function render(){
 if(!bank)return;if(!session||!user)return login();
 if(quiz)return renderQuiz();if(results)return renderResults();
 if(tab==='daily')daily();if(tab==='study')chapter===null?study():renderChapter();if(tab==='race')race();
}
function login(message=''){
 $('#app').innerHTML='<main class="login stack"><div><div class="eyebrow">每天一点，向前一步</div><h1 class="brand">法考同行</h1><p class="muted">一个人记住规则，三个人坚持更久。</p></div><section class="card"><h2>进入学习小组</h2><p class="muted">使用你的专属账号，继续今天的学习。</p><form id="login-form"><label for="username">用户名</label><input id="username" name="username" placeholder="zyl / rczy / cl" autocomplete="username" autocapitalize="none" required><label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">开始学习</button></form>'+(message?'<div class="error" role="alert">'+esc(message)+'</div>':'')+'</section><div class="notice">苹果手机：用 Safari 打开本链接，点“分享”，选择“添加到主屏幕”。首次联网加载完成后，可离线查看已缓存内容；首次登录与成绩共享需要联网。</div><small>'+esc(bank.contentStatus)+'</small></main>';
}
function streak(){let n=0,d=today();if(!progress.checkins.includes(d))d=dateShift(d,-1);while(progress.checkins.includes(d)){n++;d=dateShift(d,-1)}return n}
function daily(){
 const day=progress.days[today()]||{cards:0,answers:0},done=progress.checkins.includes(today());
 const due=bank.questions.filter(q=>progress.mastery[q.id]?.due<=today()).length;
 const studied=Object.keys(progress.mastery).length,completed=new Set(attempts.map(a=>a.set_id)).size;
 shell('<div class="stack">'+connection()+'<section class="card hero"><div class="eyebrow">今日学习 / '+today().replaceAll('-','.')+'</div><div class="row between"><div><h1>'+esc(user)+'，一起把今天学扎实</h1><p class="muted">记规则，辨例外，再用题目检验理解。</p></div><div><div class="hero-number">'+streak()+'<span style="font-size:20px;letter-spacing:0"> 天</span></div><small class="muted">连续打卡</small></div></div><div class="bar"><span style="width:'+Math.min(100,(Math.min(day.cards,5)/5+Math.min(day.answers,10)/10)/2*100)+'%"></span></div><div class="row between"><span>知识卡 '+day.cards+'/5　·　答题 '+day.answers+'/10</span><button data-action="checkin" '+(done||day.cards<5||day.answers<10?'disabled':'')+'>'+(done?'今日已打卡':'完成目标后打卡')+'</button></div></section><div class="grid stats-grid"><div class="card"><small>已学知识卡</small><div class="stat">'+studied+' <small>/ 150</small></div></div><div class="card"><small>已练题库</small><div class="stat">'+completed+' <small>/ 150</small></div></div><div class="card"><small>待复习</small><div class="stat">'+due+'</div></div></div><section class="card"><h2>留下一周的脚印</h2><div class="week">'+Array.from({length:7},(_,i)=>{const d=dateShift(today(),i-6);return '<div class="day '+(progress.checkins.includes(d)?'done ':'')+(d===today()?'today':'')+'"><small>'+d.slice(5).replace('-','/')+'</small><strong>'+(progress.checkins.includes(d)?'已打卡':d===today()?'今天':'待积累')+'</strong></div>'}).join('')+'</div></section><div class="grid two"><section class="card"><span class="pill">短时学习</span><h2 style="margin-top:14px">从一张知识卡开始</h2><p class="muted">规则、依据、易错项，学完立即练习。按 1、3、7、14 天间隔回顾。</p><button data-tab="study">继续章节学习</button></section><section class="card"><span class="pill">组队坚持</span><h2 style="margin-top:14px">一起完成一套挑战</h2><p class="muted">每套 30 题，三个人比较同一套题的首次、最高与最近成绩。</p><button data-tab="race">进入题库竞赛</button></section></div><details class="card"><summary>安装到手机与题库说明</summary><div><p>iPhone：请从微信选择“在 Safari 中打开”，再使用分享菜单中的“添加到主屏幕”。本应用不要求苹果开发者账号。</p><p>Android：可使用浏览器安装功能添加到主屏幕；原生 APK 尚未完成构建。</p><p>'+esc(bank.contentStatus)+'</p><p>基础体验版仅用于学习和自测，分数按正确题数 / 30 × 100 四舍五入；没有监考功能。成绩可被本学习组三人查看，学习笔记仅本人查看。</p><p>首次完整加载完成后缓存题库；浏览器清理数据或手机存储不足时缓存可能被系统删除。清理数据前应先完成同步。</p><button data-action="export" class="quiet">导出本人学习备份</button></div></details></div>');
}
function study(){
 const due=bank.questions.filter(q=>progress.mastery[q.id]?.due<=today()).length;
 shell(connection()+'<div class="sectionhead"><div><div class="eyebrow">LEARN / 先理解，再记忆</div><h1>把大部头，拆成小进步</h1><p class="muted">15 类基础知识 · 每类 10 张知识卡</p></div></div><div class="row" style="margin-bottom:18px"><button class="quiet" data-action="due">到期复习（'+due+'）</button><button class="quiet" data-action="wrong">错题巩固（'+progress.wrong.length+'）</button></div><div class="notice">当前是基础体验内容，尚未覆盖完整法考大纲，例如中国法律史、国际经济法等内容仍待补充。下方“知识产权”等分类为学习路径分组，不代表官方试卷科目划分。</div><div class="spacer"></div><div class="grid">'+bank.subjects.map(s=>{const qs=bank.questions.filter(q=>q.subject===s.id),count=qs.filter(q=>progress.mastery[q.id]).length;return '<section class="card subject"><span class="index">学习路径 '+String(s.id+1).padStart(2,'0')+'</span><h3>'+esc(s.title)+'</h3><small>'+count+' / '+qs.length+' 张已学习</small><div class="bar"><span style="width:'+count/qs.length*100+'%"></span></div><button class="quiet" data-chapter="'+s.id+'">'+(count?'继续学习':'开始学习')+'</button></section>'}).join('')+'</div>');
}
function renderChapter(){
 const sub=bank.subjects[chapter],qs=bank.questions.filter(q=>q.subject===chapter),q=qs[cardIndex];
 const m=progress.mastery[q.id];const note=progress.notes[q.id]?.text||'';
 shell('<div class="row between"><button class="textbutton" data-action="back-study">返回章节</button><span class="pill gray">'+(cardIndex+1)+' / '+qs.length+'</span></div><div class="sectionhead"><h1>'+esc(sub.title)+'</h1><span class="pill">'+(m?'已学 · 第'+m.level+'轮':'新知识卡')+'</span></div><div class="levelnodes">'+qs.map((x,i)=>'<button aria-label="第'+(i+1)+'张知识卡" data-card="'+i+'" class="node '+(progress.mastery[x.id]?'master ':'')+(i===cardIndex?'current':'')+'">'+(i+1)+'</button>').join('')+'</div><section class="flash"><small style="color:#b5d4ce">先想一想，再翻开规则</small><p>'+esc(q.prompt)+'</p>'+(flipped?'<div class="answer"><strong>'+esc(q.options[q.answer])+'</strong><p style="font-size:16px;margin-top:12px;color:#deeeea">'+esc(q.explanation)+'</p></div>':'<button class="outline" style="color:#d2efbf;border:1px solid #718b7a;align-self:flex-start" data-action="flip">翻开知识卡</button>')+'</section>'+(flipped?'<div class="row" style="margin:18px 0"><button class="quiet" data-remember="0">还不熟 · 明天再练</button><button data-remember="1">记住了 · 安排复习</button><button class="outline" data-practice="'+q.id+'">做一道随堂练习</button></div>':'')+'<section class="card" style="margin-top:18px"><h3>写下自己的理解</h3><textarea id="note" placeholder="例如：区分合同成立和物权变动，未登记不当然影响合同效力。">'+esc(note)+'</textarea><div class="row between" style="margin-top:12px"><a href="'+esc(q.source)+'" target="_blank" rel="noopener noreferrer">核对法律依据</a><button class="quiet" data-note="'+q.id+'">保存笔记</button></div></section><div class="quiznav"><button class="quiet" data-action="prev-card" '+(!cardIndex?'disabled':'')+'>上一张</button><button class="quiet" data-action="next-card" '+(cardIndex===qs.length-1?'disabled':'')+'>下一张</button></div>');
}
function summary(name,setId){
 const a=scores.filter(s=>s.username===name&&s.set_id===setId).sort((x,y)=>x.created_at.localeCompare(y.created_at)||x.id.localeCompare(y.id));
 return a.length?{first:a[0],last:a.at(-1),best:Math.max(...a.map(x=>x.correct)),count:a.length}:null;
}
function race(){
 const all=bank.sets.filter(s=>!filter||String(s.id).includes(filter)||s.title.includes(filter));
 const shown=all.filter(s=>viewMode==='all'||(viewMode==='done')===attempts.some(a=>a.set_id===s.id));
 const pages=Math.ceil(shown.length/15);page=Math.min(page,Math.max(0,pages-1));
 const selected=bank.sets[selectedSet-1];
 shell('<div class="stack">'+connection()+'<section class="card hero"><div class="eyebrow">CHALLENGE / 同一份题，一起进步</div><h1>题库竞赛</h1><p class="muted">150 套间隔复习训练，每套 30 题。每套题三人一致。</p><span class="pill">首次成绩 · 最高成绩 · 最近成绩</span></section><div class="notice">'+esc(bank.contentStatus)+' 完整的 4500 道独立原创题尚未制作完成。</div><section class="card"><div class="row between"><h2>'+esc(selected.title)+'</h2><button data-start="'+selected.id+'">开始本套 · 30 题</button></div><div class="tablewrap"><table><thead><tr><th>伙伴</th><th>首次</th><th>最高</th><th>最近</th><th>次数</th></tr></thead><tbody>'+names.map(n=>{const s=summary(n,selectedSet);return '<tr><td><strong>'+n+'</strong>'+(n===user?' <small>我</small>':'')+'</td><td>'+(s?score(s.first.correct):'—')+'</td><td>'+(s?score(s.best):'—')+'</td><td>'+(s?score(s.last.correct):'—')+'</td><td>'+(s?s.count:0)+'</td></tr>'}).join('')+'</tbody></table></div><small>成绩为百分制；“—”表示尚无已上传答卷。离线成绩补传后显示。'+(!navigator.onLine?' 当前显示上次同步的缓存。':'')+'</small></section><section class="card"><div class="sectionhead" style="margin-top:0"><h2>选择一套训练</h2><span class="muted">'+shown.length+' 套</span></div><div class="filters"><input id="set-filter" aria-label="搜索套题" placeholder="搜索题库编号" value="'+esc(filter)+'"><select id="set-view" aria-label="筛选完成状态"><option value="all" '+(viewMode==='all'?'selected':'')+'>全部题库</option><option value="todo" '+(viewMode==='todo'?'selected':'')+'>尚未完成</option><option value="done" '+(viewMode==='done'?'selected':'')+'>已经完成</option></select></div><div class="spacer"></div><div class="sets">'+shown.slice(page*15,page*15+15).map(s=>{const mine=attempts.filter(a=>a.set_id===s.id);return '<button class="setbtn '+(mine.length?'done ':'')+(s.id===selectedSet?'selected':'')+'" data-select="'+s.id+'"><strong>'+String(s.id).padStart(3,'0')+'</strong><small>'+(mine.length?'最高 '+score(Math.max(...mine.map(x=>x.correct)))+' 分':'30 题 · 未完成')+'</small></button>'}).join('')+'</div>'+(!shown.length?'<div class="empty">没有符合条件的题库</div>':'')+'<div class="quiznav"><button class="quiet" data-page="-1" '+(!page?'disabled':'')+'>上一页</button><small>'+(pages?page+1:0)+' / '+pages+'</small><button class="quiet" data-page="1" '+(page>=pages-1?'disabled':'')+'>下一页</button></div></section><section class="card"><h2>我的最近答卷</h2>'+attempts.slice().reverse().slice(0,5).map(a=>'<div class="row between review"><span>第 '+String(a.set_id).padStart(3,'0')+' 套 · '+score(a.correct)+' 分<br><small>'+dateText(a.ended)+' · '+(a.synced?'已上传':'等待补传')+'</small></span><button class="quiet tiny" data-result="'+a.id+'">查看解析</button></div>').join('')+(attempts.length?'':'<p class="muted">完成第一套后，答卷会保存在这里。</p>')+'</section></div>');
}
function begin(ids,mode='practice',setId=null){
 if(mode==='race'){
  const draft=read(key('draft-'+setId),null);
  if(draft&&draft.version===bank.version&&confirm('发现这套题上次未完成的答卷，要继续吗？')){quiz=draft;render();return}
 }
 quiz={ids,mode,set_id:setId,index:0,answers:ids.map(()=>-1),revealed:false,started:Date.now(),id:crypto.randomUUID(),version:bank.version};results=null;persistQuiz();render();
}
function persistQuiz(){if(quiz?.mode==='race')write(key('draft-'+quiz.set_id),quiz)}
function elapsed(){const n=Math.floor((Date.now()-quiz.started)/1000);return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')}
function renderQuiz(){
 const q=bank.questions.find(q=>q.id===quiz.ids[quiz.index]),chosen=quiz.answers[quiz.index],show=quiz.mode!=='race'&&quiz.revealed;
 $('#app').innerHTML='<header class="quiz-header"><button class="textbutton" data-action="leave-quiz">保存并返回</button><strong>'+(quiz.mode==='race'?'第 '+String(quiz.set_id).padStart(3,'0')+' 套竞赛':'知识巩固')+'</strong><span class="timer" id="timer">'+elapsed()+'</span></header><main><section class="card"><div class="row between"><span class="pill">'+esc(bank.subjects[q.subject].title)+'</span><small>'+(quiz.index+1)+' / '+quiz.ids.length+'</small></div><div class="bar"><span style="width:'+(quiz.index+1)/quiz.ids.length*100+'%"></span></div><p class="qtitle">'+esc(q.prompt)+'</p>'+((progress.mastery[q.id]||attempts.some(a=>bank.sets[a.set_id-1].questions.includes(q.id)))?'<small>此知识点曾学习或练习过，本次用于间隔巩固。</small>':'')+'<div class="options">'+q.options.map((o,i)=>'<button class="option '+(chosen===i?'chosen ':'')+(show?(i===q.answer?'right ':chosen===i?'wrong ':''):'')+'" data-answer="'+i+'" '+(show?'disabled':'')+'><span class="letter">'+String.fromCharCode(65+i)+'</span><span>'+esc(o)+'</span></button>').join('')+'</div>'+(show?'<div class="'+(chosen===q.answer?'success':'notice')+'"><strong>'+(chosen===q.answer?'回答正确':'再想想这个区别')+'</strong><p>正确答案：'+String.fromCharCode(65+q.answer)+' · '+esc(q.options[q.answer])+'</p><p>'+esc(q.explanation)+'</p><a href="'+esc(q.source)+'" target="_blank" rel="noopener noreferrer">查看依据</a></div>':'')+'<div class="quiznav"><button class="quiet" data-action="prev-q" '+(!quiz.index?'disabled':'')+'>上一题</button>'+(quiz.mode!=='race'&&!show?'<button data-action="reveal" '+(chosen<0?'disabled':'')+'>核对答案</button>':'<button data-action="'+(quiz.index===quiz.ids.length-1?'finish':'next-q')+'">'+(quiz.index===quiz.ids.length-1?'提交答卷':'下一题')+'</button>')+'</div></section>'+(quiz.mode==='race'?'<section class="card" style="margin-top:18px"><div class="row between"><strong>答题卡</strong><small>已答 '+quiz.answers.filter(a=>a>=0).length+' / 30</small></div><div class="navigator">'+quiz.ids.map((_,i)=>'<button data-qindex="'+i+'" class="'+(quiz.answers[i]>=0?'answered ':'')+(quiz.index===i?'current':'')+'">'+(i+1)+'</button>').join('')+'</div><button class="full" style="margin-top:18px" data-action="finish">提交答卷</button></section>':'')+'</main>';
}
function markWrong(q,correct){const set=new Set(progress.wrong);correct?set.delete(q.id):set.add(q.id);progress.wrong=[...set]}
async function finish(){
 if(busy)return;
 const missing=quiz.answers.filter(a=>a<0).length;
 if(missing&&!confirm('还有 '+missing+' 道未作答，未答题按错误计分。确认提交？'))return;
 busy=true;
 const run=quiz;const correct=run.ids.reduce((n,id,i)=>{const q=bank.questions.find(q=>q.id===id);markWrong(q,run.answers[i]===q.answer);return n+(run.answers[i]===q.answer?1:0)},0);
 if(run.mode==='race')activity('answers',run.ids.length);
 results={...run,correct,ended:new Date().toISOString(),synced:false};
 if(run.mode==='race'){
  attempts.push(results);queue.push({id:run.id,set_id:run.set_id,answers:run.answers});
  write(key('attempts'),attempts);write(key('queue'),queue);localStorage.removeItem(key('draft-'+run.set_id));
 }
 saveProgress();quiz=null;busy=false;renderResults();sync();
}
function renderResults(){
 const r=results,pct=Math.round(r.correct/r.ids.length*100);
 shell('<div class="stack"><section class="card" style="text-align:center"><span class="pill">'+(r.mode==='race'?'本套已完成':'巩固已完成')+'</span><h1 style="margin-top:20px">'+(pct>=80?'稳稳向前，再接再厉':'看清易错点，就是进步')+'</h1><div class="score">'+pct+'<span style="font-size:20px"> 分</span></div><p>'+r.correct+' / '+r.ids.length+' 题正确</p><p class="muted">'+(r.mode==='race'?(attempts.find(a=>a.id===r.id)?.synced?'已上传云端，伙伴可查看成绩':'答卷已保存本机，正在等待云端确认'):'本次为随堂练习，不计入套题竞赛成绩')+'</p><div class="row" style="justify-content:center"><button data-action="close-results">返回学习</button><button class="quiet" data-action="retry-wrong">再练本次错题</button></div></section><section class="card"><h2>逐题复盘</h2>'+r.ids.map((id,i)=>{const q=bank.questions.find(q=>q.id===id),ok=r.answers[i]===q.answer;return '<details class="review"><summary><span style="color:'+(ok?'var(--green)':'var(--red)')+'">'+(ok?'正确':'待巩固')+'</span> · '+(i+1)+'. '+esc(q.prompt)+'</summary><div><p>你的答案：'+(r.answers[i]<0?'未作答':esc(q.options[r.answers[i]]))+'</p><p>正确答案：'+esc(q.options[q.answer])+'</p><p class="muted">'+esc(q.explanation)+'</p><a href="'+esc(q.source)+'" target="_blank" rel="noopener noreferrer">核对依据</a></div></details>'}).join('')+'</section></div>');
}
document.addEventListener('submit',async e=>{
 if(e.target.id!=='login-form')return;e.preventDefault();const form=e.target,button=form.querySelector('button');button.disabled=true;button.textContent='正在登录…';
 try{const v=await api('login',{username:form.username.value.trim(),password:form.password.value});user=v.username;session={...v.session,username:user};write('law-session',session);loadUser();render();sync()}
 catch(err){login(err.message)}});
document.addEventListener('change',e=>{if(e.target.id==='set-view'){viewMode=e.target.value;page=0;race()}});
document.addEventListener('input',e=>{if(e.target.id==='set-filter'){filter=e.target.value;page=0;const start=e.target.selectionStart;race();$('#set-filter').focus();$('#set-filter').setSelectionRange(start,start)}});
document.addEventListener('click',async e=>{
 const el=e.target.closest('button');if(!el||el.disabled)return;const d=el.dataset;
 if(d.tab){if(quiz&&!confirm('返回模块会保留竞赛草稿，确定离开？'))return;quiz=null;results=null;tab=d.tab;chapter=null;render();return}
 if(d.chapter!==undefined){chapter=Number(d.chapter);cardIndex=0;flipped=false;render();return}
 if(d.card!==undefined){cardIndex=Number(d.card);flipped=false;render();return}
 if(d.remember!==undefined){
  const q=bank.questions.filter(q=>q.subject===chapter)[cardIndex],old=progress.mastery[q.id],ok=d.remember==='1';
  const level=ok?Math.min(4,(old?.level||0)+1):0,interval=[1,1,3,7,14][level];
  progress.mastery[q.id]={level,due:dateShift(today(),interval),at:Date.now()};activity('cards');toast(ok?'已加入间隔复习计划':'明天再回顾一次');
  const qs=bank.questions.filter(q=>q.subject===chapter);if(cardIndex<qs.length-1)cardIndex++;flipped=false;render();return;
 }
 if(d.note){progress.notes[d.note]={text:$('#note').value.slice(0,5000),at:Date.now()};saveProgress();toast('笔记已保存在本机，将同步云端');return}
 if(d.practice){begin([d.practice]);return}
 if(d.select){selectedSet=Number(d.select);race();return}
 if(d.start){const s=bank.sets[Number(d.start)-1];begin(s.questions,'race',s.id);return}
 if(d.page){page+=Number(d.page);race();return}
 if(d.result){const a=attempts.find(a=>a.id===d.result);if(a){results=a;render()}return}
 if(d.answer!==undefined){quiz.answers[quiz.index]=Number(d.answer);persistQuiz();renderQuiz();return}
 if(d.qindex!==undefined){quiz.index=Number(d.qindex);quiz.revealed=false;persistQuiz();renderQuiz();return}
 switch(d.action){
 case'logout':if(syncing){toast('正在同步，请稍后退出');return}if(queue.length&&!confirm('仍有未上传答卷，退出后本机保留，重新登录同一账号可补传。确定退出？'))return;session=null;user=null;quiz=null;results=null;localStorage.removeItem('law-session');login();break;
 case'sync':await sync();if(results)renderResults();toast(cloudError||'同步完成');break;
 case'checkin':{const day=progress.days[today()]||{};if((day.cards||0)>=5&&(day.answers||0)>=10&&!progress.checkins.includes(today())){progress.checkins.push(today());saveProgress();render();toast('今天的努力，已记下。')}break}
 case'back-study':chapter=null;render();break;
 case'flip':flipped=true;render();break;
 case'prev-card':cardIndex--;flipped=false;render();break;
 case'next-card':cardIndex++;flipped=false;render();break;
 case'due':{const ids=bank.questions.filter(q=>progress.mastery[q.id]?.due<=today()).map(q=>q.id);ids.length?begin(ids):toast('还没有到期知识点，可以先学新章节');break}
 case'wrong':progress.wrong.length?begin(progress.wrong):toast('错题本为空，先完成一次练习');break;
 case'prev-q':quiz.index--;quiz.revealed=false;persistQuiz();renderQuiz();break;
 case'next-q':quiz.index++;quiz.revealed=false;persistQuiz();renderQuiz();break;
 case'reveal':{const q=bank.questions.find(q=>q.id===quiz.ids[quiz.index]);quiz.revealed=true;markWrong(q,quiz.answers[quiz.index]===q.answer);activity('answers');renderQuiz();break}
 case'finish':await finish();break;
 case'leave-quiz':persistQuiz();quiz=null;render();break;
 case'close-results':results=null;render();break;
 case'retry-wrong':{const ids=results.ids.filter((id,i)=>bank.questions.find(q=>q.id===id).answer!==results.answers[i]);ids.length?begin(ids):toast('本次全部答对了，可以开始下一套');break}
 case'export':{const blob=new Blob([JSON.stringify({version:bank.version,username:user,progress,attempts,pending:queue},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=window.URL.createObjectURL(blob);a.download='法考同行_'+user+'_'+today()+'.json';a.click();setTimeout(()=>window.URL.revokeObjectURL(a.href),1000);break}
 }
});
window.addEventListener('online',()=>{toast('网络已恢复，正在补传记录');sync()});
window.addEventListener('offline',()=>{if(!quiz&&!results)render()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&user)sync()});
setInterval(()=>{if(quiz&&$('#timer'))$('#timer').textContent=elapsed()},1000);
try{
 const response=await fetch('./bank.json');if(!response.ok)throw Error('题库加载失败');bank=await response.json();if(user)loadUser();render();
 if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(()=>toast('离线学习缓存已准备')).catch(()=>{});
 if(user)sync();
}catch(e){$('#app').innerHTML='<main><h1>暂时无法加载学习内容</h1><p>'+esc(e.message)+'</p><button onclick="location.reload()">重新加载</button></main>'}
