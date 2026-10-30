/* 오늘의 시사 — 화면 동작 */
(() => {
const CFG = window.TODAY_NEWS_CONFIG || {};
const $app = document.getElementById('app');
const qs = new URLSearchParams(location.search);
const LS = {
  get(k, d){ try{ const v = localStorage.getItem('tn:'+k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem('tn:'+k, JSON.stringify(v)); }catch(e){} },
  del(k){ try{ localStorage.removeItem('tn:'+k); }catch(e){} }
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TYPE_NAME = {useful:'알아두면 유익', debate:'생각이 갈림', media:'미디어 읽기'};
const W6 = {who:'누가', when:'언제', where:'어디서', what:'무엇을', how:'어떻게', why:'왜'};
const SHEET_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
const todayKST = () => new Date(Date.now() + 9*3600e3).toISOString().slice(0,10);
const BASE = location.origin + location.pathname;

let DAY = null, INDEX = [];
let ITEM = null;       // 지금 다루는 뉴스(순위 하나)
let CLASS = null;      // 학생: {url, name, code}
let STUDENT = null;    // {number, name}
let state = {};        // 학생 답
let tvMode = false;
let soloMode = false;   // 반 없이 QR로 들어와 혼자 풀기 (답 제출 없음)

/* ───────── 데이터 ───────── */
async function getJSON(path){
  const r = await fetch(path + (path.includes('?') ? '&' : '?') + 't=' + Date.now(), {cache:'no-store'});
  if(!r.ok) throw new Error(r.status);
  return r.json();
}
// 예전(1순위만 학습지) 형식도 읽을 수 있게 맞춤
function normalize(d){
  if(d.items) return d;
  const items = [{...d.main, rank:1, needs_review:d.needs_review, review_notes:d.review_notes}];
  (d.others||[]).forEach(o => items.push({...o, summary:o.brief_summary, brief:true}));
  return {...d, items};
}
const itemByRank = r => DAY.items.find(it => it.rank === Number(r)) || DAY.items[0];
const full = it => it && !it.brief && it.words;

/* ───────── 화면 이동 (뒤로 가기 지원) ───────── */
const VIEWS = {};
let depth = 0;
function go(view, params = {}, replace = false){
  const st = {view, params, d: replace ? depth : depth + 1};
  if(replace) history.replaceState(st, ''); else history.pushState(st, '');
  depth = st.d;
  render(st);
}
function render(st){
  depth = st.d || 0;
  document.getElementById('backBtn').hidden = depth <= 0;
  (VIEWS[st.view] || VIEWS.home)(st.params || {});
  window.scrollTo({top:0});
}
window.addEventListener('popstate', e => { if(e.state) render(e.state); });
document.getElementById('backBtn').onclick = () => history.back();
document.getElementById('homeBtn').onclick = () => go(soloMode && ITEM ? 'soloHome' : CLASS && STUDENT ? 'studentHome' : 'home', soloMode && ITEM ? {r:ITEM.rank} : {});
function show(html, wide){ $app.innerHTML = html; $app.classList.toggle('wide', !!wide); }

function setStamp(dateStr){
  const [y,m,d] = dateStr.split('-').map(Number);
  const wd = '일월화수목금토'[new Date(y, m-1, d).getDay()];
  document.getElementById('stamp').innerHTML = `<div><b>${d}</b><small>${wd}요일</small></div>`;
  document.getElementById('brandSub').textContent = `${m}월 ${d}일 아침 시사`;
}
function banners(forTeacher, it){
  let h = '';
  if(DAY.sample) h += `<div class="banner info">지금은 <b>예시 화면</b>이에요. 첫 자동 실행이 끝나면 실제 뉴스로 바뀝니다.</div>`;
  if(!qs.get('date') && DAY.date !== todayKST()) h += `<div class="banner info">오늘 학습지가 아직 없어 가장 최근(${esc(DAY.date)}) 학습지를 보여 줘요.</div>`;
  if(forTeacher && it && it.needs_review) h += `<div class="banner warn">자동 검사에서 확인이 필요한 부분이 있었어요: ${esc((it.review_notes||[]).join(', '))}. 수업 전에 한 번 읽어 봐 주세요.</div>`;
  return h;
}
const footer = () => `<p class="foot">뉴스 선정과 학습지는 AI가 자동으로 만들었어요. 수업 전 선생님 검토를 권장합니다. 기사 원문은 각 언론사에 있으며, 이 사이트는 새로 쓴 요약과 링크만 제공합니다.</p>`;
const reviewLink = it => `${BASE}?date=${DAY.date}&r=${it.rank}&v=1`;
const videoLink = v => v ? `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}` : '';

/* ───────── 첫 화면 ───────── */
VIEWS.home = () => {
  show(`${banners(false)}
    <h2>누구세요?</h2>
    <div class="choice">
      <button class="big" id="goT" type="button"><strong>선생님</strong><span>오늘의 뉴스 1~5순위 보기, 우리 반 주제 정하기, 학습지 인쇄</span></button>
      <button class="big" id="goS" type="button"><strong>학생</strong><span>QR을 찍거나 반코드를 넣고 들어가요</span></button>
    </div>
    <p class="muted"><a href="#" id="goArc">지난 학습지 보기</a></p>${footer()}`);
  goT.onclick = () => go(LS.get('teacherOK', '') === CFG.TEACHER_PASS_SHA256 ? 'teacherHome' : 'teacherGate');
  goS.onclick = () => {
    const saved = LS.get('class', null);
    if(saved && saved.url){ CLASS = saved; STUDENT = LS.get('student', null); return go(STUDENT ? 'studentHome' : 'nameEntry'); }
    go('codeEntry');
  };
  goArc.onclick = e => { e.preventDefault(); go('archive'); };
};

/* ───────── 교사 비밀번호 ───────── */
async function sha256(t){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
}
VIEWS.teacherGate = () => {
  show(`<h2>선생님 확인</h2><p>선생님 화면에는 정답과 예시 답안이 있어요. 비밀번호를 넣어 주세요.</p>
    <input type="password" id="pw" autocomplete="current-password" style="width:100%;border:2px solid var(--line);border-radius:10px;padding:12px 14px;font-size:18px">
    <div class="row"><button class="btn" id="pwGo" type="button">들어가기</button></div>
    <p class="muted" id="pwMsg">이 기기에서 한 번 넣으면 다음부터는 묻지 않아요.</p>`);
  const tryIt = async () => {
    if(!(window.crypto && crypto.subtle)){ pwMsg.textContent = '이 브라우저에서는 확인할 수 없어요. 크롬이나 웨일로 열어 주세요.'; return; }
    const h = await sha256(pw.value.trim());
    if(h !== CFG.TEACHER_PASS_SHA256){ pwMsg.textContent = '비밀번호가 맞지 않아요.'; pw.select(); return; }
    LS.set('teacherOK', h);
    go('teacherHome', {}, true);
  };
  pwGo.onclick = tryIt;
  pw.onkeydown = e => { if(e.key === 'Enter') tryIt(); };
  pw.focus();
};
const teacherOK = () => LS.get('teacherOK', '') === CFG.TEACHER_PASS_SHA256;

/* ───────── 교사: 오늘의 뉴스 1~5순위 ───────── */
VIEWS.teacherHome = () => {
  if(!teacherOK()) return go('teacherGate', {}, true);
  const mine = LS.get('myClass', null);
  const topicRank = mine ? LS.get(`topic:${mine.url}:${DAY.date}`, null) : null;
  show(`${banners(false)}
    <div class="panel">${mine
      ? `<b>우리 반: ${esc(mine.name)}</b>${mine.code ? ` · 반코드 <b>${esc(mine.code)}</b>` : ''}
         <p class="muted" id="topicNow">오늘 주제: ${topicRank ? `${topicRank}순위` : '아직 고르지 않음 (고를 때까지 아이들은 기다리는 화면을 봐요)'}</p>
         <div class="row"><button class="btn sun small-btn" id="toRes" type="button">답 모아 보기</button>
           <button class="btn ghost small-btn" id="toQR" type="button">QR·반 링크 보기</button>
           ${mine.sheetUrl ? `<a class="btn ghost small-btn" href="${esc(mine.sheetUrl)}" target="_blank" rel="noopener">내 답안 시트 열기</a>` : ''}</div>`
      : `<b>학생과 함께 하려면</b><p class="muted">내 구글 시트를 연결해 반을 만들면, 아이들은 QR·반코드로 들어오고 답이 시트로 모여요. 인쇄만 하실 거면 안 하셔도 돼요.</p>
         <div class="row"><button class="btn ghost small-btn" id="toSetup" type="button">반 만들기 (5분)</button></div>`}
    </div>
    <h2>오늘의 뉴스</h2>
    <p class="muted">${mine ? '하나를 골라 <b>우리 반 주제로 정하기</b>를 누르면 QR·반코드 화면이 크게 떠요. 아이들 화면에도 그 뉴스가 떠요.' : '학습지 인쇄, 교사용 자료, TV 화면을 바로 쓸 수 있어요. <b>QR 크게 띄우기</b>로 아이들이 각자 풀게 할 수도 있어요 (답은 모이지 않아요).'}</p>
    <ol class="rank-list">${DAY.items.map(it => `
      <li><span class="num">${it.rank}</span><div>
        <span class="tag ${it.type}">${TYPE_NAME[it.type]}</span><span class="tag cat">${esc(it.category)}</span>
        ${topicRank === it.rank ? '<span class="picked-topic">오늘 우리 반 주제</span>' : ''}
        <h3 style="margin-top:6px">${esc(it.title)}</h3>
        <p>${(it.summary||[]).map(esc).join(' ')}</p>
        <p class="muted">선정 이유: ${esc(it.reason)}</p>
        <div class="row">
          ${mine && full(it) ? `<button class="btn ${topicRank === it.rank ? 'ghost' : 'sun'} small-btn" data-topic="${it.rank}" type="button">${topicRank === it.rank ? '✓ 우리 반 주제' : '우리 반 주제로 정하기'}</button>` : ''}
          ${full(it) && (!mine || topicRank === it.rank) ? `<button class="btn ${mine ? 'sun' : 'ghost'} small-btn" data-share="${it.rank}" type="button">QR 크게 띄우기</button>` : ''}
          ${full(it) ? `<button class="btn small-btn" data-tv="${it.rank}" type="button">TV 화면</button>
            <button class="btn ghost small-btn" data-print="${it.rank}" type="button">학습지 인쇄</button>
            <button class="btn ghost small-btn" data-guide="${it.rank}" type="button">교사용</button>` : ''}
          ${it.video ? `<a class="btn ghost small-btn" href="${videoLink(it.video)}" target="_blank" rel="noopener">영상 (${esc(it.video.channel)})</a>` : ''}
          <a class="btn ghost small-btn" href="${esc(it.link)}" target="_blank" rel="noopener">기사 원문 (${esc(it.source)})</a>
        </div>
        ${it.needs_review ? `<p class="muted" style="color:var(--warn)">자동 검사에서 확인이 필요한 부분이 있어요. 교사용에서 확인해 주세요.</p>` : ''}
      </div></li>`).join('')}</ol>
    <details class="panel"><summary>오늘 뉴스가 수업에 맞지 않나요?</summary>
      <p class="muted">이유를 보내 주시면 선정 지침을 고치는 데 씁니다.</p>
      <div class="row">${['너무 어려움','부적절함','지루함','기타'].map(r => `<button class="btn ghost small-btn" data-reason="${r}" type="button">${r}</button>`).join('')}</div>
      <input type="text" id="fbMemo" placeholder="한 줄 메모 (선택)"><p class="muted" id="fbMsg"></p>
    </details>${footer()}`);
  if(mine){ toQR.onclick = () => go('classReady'); toRes.onclick = () => go('results', {r: topicRank || 1}); refreshTopic(mine); }
  else toSetup.onclick = () => go('classSetup');
  document.querySelectorAll('[data-topic]').forEach(b => b.onclick = () => setTopic(mine, Number(b.dataset.topic), b));
  document.querySelectorAll('[data-tv]').forEach(b => b.onclick = () => { ITEM = itemByRank(b.dataset.tv); tvMode = true; state = {}; STUDENT = {number:'', name:'우리 반'}; go('step', {i:0, r:ITEM.rank, tv:1}); });
  document.querySelectorAll('[data-share]').forEach(b => b.onclick = () => go('share', {r:Number(b.dataset.share)}));
  document.querySelectorAll('[data-print]').forEach(b => b.onclick = () => printSheet(itemByRank(b.dataset.print), false));
  document.querySelectorAll('[data-guide]').forEach(b => b.onclick = () => go('guide', {r:Number(b.dataset.guide)}));
  document.querySelectorAll('[data-reason]').forEach(b => b.onclick = () => sendFeedback(b.dataset.reason));
};

async function refreshTopic(mine){
  if(!mine.sheetUrl){
    try{ const p = await (await fetch(mine.url + '?action=ping')).json();
      if(p.sheetUrl){ LS.set('myClass', {...mine, sheetUrl:p.sheetUrl}); } }catch(e){}
  }
  try{
    const r = await (await fetch(mine.url + '?action=topic')).json();
    if(r.ok && r.date === DAY.date && r.rank && LS.get(`topic:${mine.url}:${DAY.date}`, null) !== r.rank){
      LS.set(`topic:${mine.url}:${DAY.date}`, r.rank);
      if(history.state && history.state.view === 'teacherHome') VIEWS.teacherHome();
    }
  }catch(e){}
}

async function setTopic(mine, rank, btn){
  btn.disabled = true; btn.textContent = '저장하는 중…';
  const payload = JSON.stringify({app:'today-news', action:'setTopic', date:DAY.date, rank, key: mine.key || ''});
  let ok = false, err = '';
  try{ const j = await (await fetch(mine.url, {method:'POST', body:payload})).json(); ok = !!j.ok; err = j.error || ''; }
  catch(e){
    try{ await fetch(mine.url, {method:'POST', body:payload, mode:'no-cors'});
      const t = await (await fetch(mine.url + '?action=topic')).json();  // 정말 저장됐는지 확인
      ok = t.ok && t.date === DAY.date && Number(t.rank) === rank; if(!ok) err = 'key';
    }catch(e2){}
  }
  if(!ok){
    btn.disabled = false;
    if(err === 'key'){ btn.textContent = '선생님 열쇠가 필요해요'; setTimeout(() => go('results', {r:rank}), 900); }
    else btn.textContent = '다시 눌러 주세요 (저장 실패)';
    return;
  }
  LS.set(`topic:${mine.url}:${DAY.date}`, rank);
  go('share', {r:rank});
}

async function sendFeedback(reason){
  if(!CFG.REGISTRY_URL){ fbMsg.textContent = '의견 보내기는 운영자가 등록소를 연결한 뒤에 쓸 수 있어요.'; return; }
  try{
    await fetch(`${CFG.REGISTRY_URL}?action=feedback&date=${encodeURIComponent(DAY.date)}&reason=${encodeURIComponent(reason)}&memo=${encodeURIComponent(fbMemo.value)}`);
    fbMsg.textContent = '보냈어요. 고맙습니다.';
  }catch(e){ fbMsg.textContent = '보내지 못했어요. 인터넷 연결을 확인해 주세요.'; }
}

/* ───────── 주제 공유: 큰 QR + 반코드 ───────── */
const soloLink = it => `${BASE}?date=${DAY.date}&r=${it.rank}&solo=1`;
VIEWS.share = ({r}) => {
  if(!teacherOK()) return go('teacherGate', {}, true);
  const it = itemByRank(r), mine = LS.get('myClass', null);
  const link = mine ? classLink(mine) : soloLink(it);
  show(`<div class="share">
      <p class="muted">${r}순위 · ${TYPE_NAME[it.type]}</p>
      <h2 class="share-title">${esc(it.title)}</h2>
      <div class="share-grid">
        <div class="share-qr" id="bigQR" aria-label="들어오는 QR 코드"></div>
        <div class="share-info">
          ${mine && mine.code ? `<p class="muted">반코드</p><div class="share-code">${esc(mine.code)}</div>` : ''}
          <p class="share-how">${mine
            ? (mine.code ? '학생 → 반코드 입력, 또는 QR 찍기' : 'QR을 찍어 들어와요')
            : 'QR을 찍어 들어와요<br><span class="muted">반을 만들지 않아 답은 모이지 않아요</span>'}</p>
        </div>
      </div>
      <h3>어떻게 할까요?</h3>
      <div class="choice two-col">
        <button class="big" id="shTV" type="button"><strong>교실 화면으로 함께 보기</strong><span>영상부터 TV에 띄우고 다 같이 이야기해요</span></button>
        <button class="big" id="shSolo" type="button"><strong>아이들이 각자 보기</strong><span>이 화면을 띄워 두면 아이들이 QR${mine && mine.code ? '·반코드' : ''}로 들어와 각자 풀어요</span></button>
      </div>
      <div class="row"><button class="btn ghost small-btn" id="shFull" type="button">전체 화면</button>
        ${mine ? '<button class="btn ghost small-btn" id="shRes" type="button">답 모아 보기</button>' : ''}
        <button class="btn ghost small-btn" id="shBack" type="button">뉴스 목록으로</button></div>
    </div>`, true);
  drawQR(document.getElementById('bigQR'), link, 360);
  shTV.onclick = () => { ITEM = it; tvMode = true; state = {}; STUDENT = {number:'', name:'우리 반'}; go('step', {i:0, r:it.rank, tv:1}); };
  shSolo.onclick = () => { shSolo.querySelector('span').textContent = '아이들이 들어오는 동안 이 화면을 그대로 띄워 두세요.'; document.getElementById('bigQR').scrollIntoView({behavior:'smooth', block:'center'}); };
  shFull.onclick = () => { const el = document.documentElement; (el.requestFullscreen ? el.requestFullscreen() : Promise.reject()).catch(() => {}); };
  shBack.onclick = () => go('teacherHome');
  if(mine) shRes.onclick = () => go('results', {r});
};

/* ───────── 답 모아 보기 ───────── */
function randKey(){
  const a = new Uint8Array(18); crypto.getRandomValues(a);
  return [...a].map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'[b % 56]).join('');
}
async function initKey(url){
  const key = randKey();
  const body = JSON.stringify({app:'today-news', action:'initKey', key});
  try{ const j = await (await fetch(url, {method:'POST', body})).json(); return j.ok ? key : ''; }
  catch(e){ try{ await fetch(url, {method:'POST', body, mode:'no-cors'}); return key; }catch(e2){ return ''; } }
}
let resTimer = null;
const pct = (n, d) => d ? Math.round(n / d * 100) : 0;
const bar = (label, n, total, cls = '') => `<div class="bar-row"><div class="bar-label">${label}</div>
  <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct(n,total)}%"></div></div><div class="bar-num">${n}명${total ? ` · ${pct(n,total)}%` : ''}</div></div>`;

VIEWS.results = async ({r}) => {
  if(!teacherOK()) return go('teacherGate', {}, true);
  clearInterval(resTimer);
  const mine = LS.get('myClass', null);
  if(!mine) return go('classSetup', {}, true);
  const it = itemByRank(r);
  const hideNames = LS.get('hideNames', false);
  show(`<div class="tabs" role="tablist">${DAY.items.filter(full).map(x => `<button role="tab" aria-selected="${x.rank===it.rank}" data-rr="${x.rank}" type="button">${x.rank}순위</button>`).join('')}</div>
    <h2>${esc(it.title)}</h2>
    <div class="row"><label class="muted"><input type="checkbox" id="hideN" ${hideNames?'checked':''}> 이름 가리기 (TV에 띄울 때)</label>
      <label class="muted"><input type="checkbox" id="autoR" checked> 15초마다 새로고침</label>
      <button class="btn ghost small-btn" id="reload" type="button">지금 새로고침</button></div>
    <div id="resBody"><p class="muted">답을 불러오는 중이에요.</p></div>`, true);
  document.querySelectorAll('[data-rr]').forEach(b => b.onclick = () => go('results', {r:Number(b.dataset.rr)}, true));
  hideN.onchange = () => { LS.set('hideNames', hideN.checked); load(); };
  reload.onclick = () => load();
  const myView = history.state;
  const tick = () => { if(history.state !== myView || !document.getElementById('resBody')){ clearInterval(resTimer); return; } if(autoR.checked) load(); };
  resTimer = setInterval(tick, 15000);

  async function load(){
    const m = LS.get('myClass', mine);
    const body = document.getElementById('resBody'); if(!body) return;
    let res = null;
    try{ res = await (await fetch(`${m.url}?action=answers&date=${DAY.date}&key=${encodeURIComponent(m.key || '')}`)).json(); }
    catch(e){ body.innerHTML = '<p class="muted">시트에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.</p>'; return; }
    if(!res.ok){ return keyHelp(body, m); }
    renderResults(body, it, (res.rows||[]).filter(x => (x.detail && x.detail.rank === it.rank) || String(x.title).startsWith(`[${it.rank}순위]`)), document.getElementById('hideN').checked);
  }
  load();
};

async function keyHelp(body, m){
  let ping = {};
  try{ ping = await (await fetch(m.url + '?action=ping')).json(); }catch(e){}
  if(!(ping.version >= 2)){
    body.innerHTML = `<div class="panel"><b>시트 코드를 새로 바꿔 주세요</b>
      <p>답 모아 보기는 새 시트 코드에서 쓸 수 있어요. 답안 시트의 Apps Script에 아래 주소의 코드를 붙여 넣고,
      <b>배포 → 배포 관리 → 연필 → 버전: 새 버전 → 배포</b>를 눌러 주세요. (웹 앱 주소는 그대로예요)</p>
      <p><a href="https://raw.githubusercontent.com/today-sisa/today-sisa.github.io/main/apps-script/teacher-sheet.gs" target="_blank" rel="noopener">새 시트 코드 열기</a></p></div>`;
    return;
  }
  if(!ping.hasKey){
    body.innerHTML = `<div class="panel"><b>선생님 열쇠 만들기</b><p>이 기기에서 답을 볼 수 있게 열쇠를 만들어요. 열쇠는 답안 시트의 '설정' 탭에도 적혀요.</p>
      <button class="btn sun" id="mkKey" type="button">열쇠 만들고 답 보기</button><p class="muted" id="mkMsg"></p></div>`;
    mkKey.onclick = async () => {
      mkKey.disabled = true;
      const key = await initKey(m.url);
      if(!key){ mkMsg.textContent = '만들지 못했어요. 다시 눌러 주세요.'; mkKey.disabled = false; return; }
      LS.set('myClass', {...m, key}); VIEWS.results(history.state.params);
    };
    return;
  }
  body.innerHTML = `<div class="panel"><b>선생님 열쇠를 넣어 주세요</b>
    <p>다른 기기에서 만든 반이에요. 답안 시트의 <b>'설정' 탭 B1 칸</b>에 있는 열쇠를 복사해 붙여 넣으면 이 기기에서도 답을 볼 수 있어요.</p>
    <input type="text" id="keyIn" autocomplete="off" placeholder="열쇠 붙여 넣기">
    <div class="row"><button class="btn" id="keyGo" type="button">확인</button><span class="muted" id="keyMsg"></span></div></div>`;
  keyGo.onclick = () => { const k = keyIn.value.trim(); if(!k){ keyMsg.textContent = '열쇠를 붙여 넣어 주세요.'; return; }
    LS.set('myClass', {...m, key:k}); VIEWS.results(history.state.params); };
}

function renderResults(body, it, rows, hide){
  // 같은 학생이 여러 번 내면 마지막 것만
  const byStu = new Map();
  rows.forEach(x => byStu.set(`${x.number}|${x.name}`, x));
  const list = [...byStu.values()].sort((a,b) => Number(a.number) - Number(b.number));
  const n = list.length;
  const who = (x, i) => hide ? `학생 ${i+1}` : `${esc(x.number)}번 ${esc(x.name)}`;
  if(!n){ body.innerHTML = `<div class="panel"><p>아직 낸 학생이 없어요. 아이들이 보내면 여기에 나타나요.</p></div>`; return; }
  const a = it.activity || {}, D = list.map(x => x.detail || {});
  let h = `<div class="panel"><h3>낸 학생 ${n}명</h3><div class="chips">${list.map((x,i) => `<span class="chip">${who(x,i)}</span>`).join('')}</div></div>`;

  if(it.type === 'debate'){
    const sideOf = (x, d) => d.side || (/^\[(.+?)\]/.exec((x.answers.find(q => q.q === a.choose_question) || {}).a || '') || [])[1];
    const tA = a.side_a.title, tB = a.side_b.title;
    let ca = 0, cb = 0;
    list.forEach((x,i) => { const s = sideOf(x, D[i]); if(s === 'a' || s === tA) ca++; else if(s === 'b' || s === tB) cb++; });
    h += `<div class="panel"><h3>${esc(a.issue)}</h3>${bar(esc(tA), ca, n, 'a')}${bar(esc(tB), cb, n, 'b')}${n-ca-cb ? `<p class="muted">고르지 않은 학생 ${n-ca-cb}명</p>` : ''}</div>`;
  }
  if(it.type === 'media'){
    const cnt = {}; D.forEach(d => { if(d.feeling) cnt[d.feeling] = (cnt[d.feeling]||0) + 1; });
    h += `<div class="panel"><h3>제목들이 주는 느낌</h3>${(a.feeling_choices||[]).map(c => bar(esc(c), cnt[c]||0, n)).join('')}</div>`;
  }
  const withD = D.filter(d => Array.isArray(d.fo));
  if(withD.length){
    const fo = it.facts_opinions || [];
    const rates = fo.map((f,k) => withD.filter(d => d.fo[k]).length);
    const worst = rates.indexOf(Math.min(...rates));
    h += `<div class="panel"><h3>사실일까 의견일까 · 맞힌 학생</h3>${fo.map((f,k) =>
      bar(`${k===worst && rates[k] < withD.length ? '⚠️ ' : ''}${esc(f.sentence)} <span class="muted">(${esc(f.answer)})</span>`, rates[k], withD.length, k===worst && rates[k] < withD.length ? 'warn' : 'ok')).join('')}
      ${rates[worst] < withD.length ? `<p class="muted">⚠️ 가장 많이 헷갈린 문장이에요. 함께 이야기해 보세요.</p>` : ''}</div>`;
    const words = it.words || [];
    h += `<div class="panel"><h3>오늘의 낱말 · 맞힌 학생</h3>${words.map((w,k) => bar(`${esc(w.word)} <span class="muted">(${esc(w.meaning)})</span>`, withD.filter(d => d.words && d.words[k]).length, withD.length, 'ok')).join('')}</div>`;
  }
  const W6k = Object.keys(W6);
  if(D.some(d => d.w5 && Object.keys(d.w5).length)){
    h += `<div class="panel"><h3>육하원칙</h3><div class="w6-grid">${W6k.map(k => `<div class="w6-col"><b>${W6[k]}</b>
      <div class="ans">기사: ${esc((it.five_w||{})[k])}</div>
      ${list.map((x,i) => D[i].w5 && D[i].w5[k] ? `<div class="mini">${esc(D[i].w5[k])}${hide ? '' : ` <span class="muted">- ${esc(x.name)}</span>`}</div>` : '').join('')}</div>`).join('')}</div></div>`;
  }
  const QS = [['impact_question'],['wonder_question'],['choose_question'],['other_side_question'],['why_question'],['rewrite_question'],['challenge']]
    .map(([k]) => [k, k === 'challenge' ? it.challenge : a[k]]).filter(([k,q]) => q);
  QS.forEach(([k,q]) => {
    const items = list.map((x,i) => {
      let v = (D[i].writes || {})[k];
      if(!v){ const f = x.answers.find(y => y.q === q || y.q === '[도전] ' + q); v = f ? f.a.replace(/^\[.*?\]\s*/, '') : ''; }
      const side = k === 'choose_question' && it.type === 'debate' ? (D[i].side === 'a' ? a.side_a.title : D[i].side === 'b' ? a.side_b.title : '') : '';
      return v ? `<div class="card-ans ${side ? (D[i].side === 'a' ? 'sa' : 'sb') : ''}">${side ? `<small>${esc(side)}</small>` : ''}${esc(v)}<div class="muted">${who(x,i)}</div></div>` : '';
    }).filter(Boolean);
    if(items.length) h += `<div class="panel"><h3>✏️ ${esc(q)}</h3><div class="cards">${items.join('')}</div></div>`;
  });
  body.innerHTML = h;
}

/* ───────── 교사용 자료 ───────── */
function questionLabel(it, k){
  const a = it.activity || {};
  return {choose_question:a.choose_question, other_side_question:a.other_side_question, impact_question:a.impact_question,
    wonder_question:a.wonder_question, why_question:a.why_question, rewrite_question:a.rewrite_question,
    challenge:it.challenge}[k] || k;
}
VIEWS.guide = ({r}) => {
  if(!teacherOK()) return go('teacherGate', {}, true);
  const it = itemByRank(r), t = it.teacher || {};
  show(`${banners(true, it)}<h2>${esc(it.title)}</h2><p class="muted">${r}순위 · ${TYPE_NAME[it.type]} · 교사용</p>
    <div class="row"><button class="btn" id="pr1" type="button">학습지 인쇄</button>
      <button class="btn ghost" id="pr2" type="button">정답·예시 답안 포함 인쇄</button></div>
    <div class="panel">
      <h3>교과 연계</h3><p>${(it.curriculum||[]).map(esc).join('<br>')}</p>
      <h3>육하원칙</h3>${Object.keys(W6).map(k => `<p>${W6[k]}: <b>${esc((it.five_w||{})[k])}</b></p>`).join('')}
      <h3>예시 답안</h3>${Object.entries(t.sample_answers||{}).map(([k,v]) => `<p class="muted">${esc(questionLabel(it,k))}</p><div class="answer">${esc(v)}</div>`).join('')}
      <h3>사실·의견 정답</h3>${(it.facts_opinions||[]).map(f => `<p>${esc(f.sentence)} → <b>${esc(f.answer)}</b> <span class="muted">${esc(f.reason)}</span></p>`).join('')}
      <h3>더 물어볼 질문</h3><ul>${(t.extra_questions||[]).map(q => `<li>${esc(q)}</li>`).join('')}</ul>
      <h3>지도할 때 주의할 점</h3><ul>${(t.cautions||[]).map(q => `<li>${esc(q)}</li>`).join('')}</ul>
    </div>`);
  pr1.onclick = () => printSheet(it, false);
  pr2.onclick = () => printSheet(it, true);
};

/* ───────── 반 만들기 ───────── */
const GUIDE = [
  {img:'1-apps-script', t:'복사한 시트에서 <b>확장 프로그램 → Apps Script</b>를 눌러요.', alt:'확장 프로그램 메뉴의 Apps Script'},
  {img:'2-editor', t:'코드가 이미 들어 있어요. 고치지 말고 오른쪽 위 <b>배포</b>를 눌러요.', alt:'코드가 들어 있는 Apps Script 화면'},
  {img:'3-deploy-menu', t:'<b>새 배포</b>를 골라요.', alt:'배포 메뉴의 새 배포'},
  {img:'4-gear', t:'왼쪽 <b>유형 선택</b> 옆 톱니바퀴를 눌러요.', alt:'새 배포 창의 톱니바퀴'},
  {img:'5-webapp', t:'<b>웹 앱</b>을 골라요.', alt:'유형 목록의 웹 앱'},
  {img:'6-settings', t:'실행: <b>나</b>, 액세스 권한: <b>모든 사용자</b>로 맞추고 아래 <b>배포</b>를 눌러요.', alt:'웹 앱 설정 화면'},
  {img:'7-approve', t:'<b>액세스 승인</b>을 누르고 내 구글 계정을 골라요.', alt:'액세스 승인 버튼'},
  {img:'8-continue', t:'"확인되지 않은 앱" 경고가 나오면 <b>고급 → (안전하지 않음)으로 이동</b>을 누르고, 이 화면에서 <b>Continue(허용)</b>를 눌러요. 선생님 시트 안의 코드라 괜찮아요.', alt:'권한 허용 화면'},
  {img:'9-url', t:'<b>웹 앱 URL</b> 아래 <b>복사</b>를 눌러요. 배포 ID가 아니라 URL을 복사해야 해요.', alt:'배포 완료 화면의 웹 앱 URL 복사 버튼'},
];
let gsCode = '';
VIEWS.classSetup = async () => {
  show(`<h2>반 만들기</h2>
    <p>학생 답과 오늘의 주제는 <b>선생님의 구글 시트에만</b> 저장돼요. 처음 한 번만 하면 됩니다. (3분)</p>
    <div class="panel"><ol class="steps">
      <li><b>답안 시트 사본 만들기</b>
        ${CFG.TEMPLATE_SHEET_COPY_URL ? `<div class="row"><a class="btn sun" href="${esc(CFG.TEMPLATE_SHEET_COPY_URL)}" target="_blank" rel="noopener">구글 시트 사본 만들기</a></div>
        <span class="muted">새 창에서 <b>사본 만들기</b>를 누르면 내 드라이브에 시트가 생겨요. 이름은 '오늘의 시사 답안 - ○반'처럼 바꿔도 돼요.</span>` : '<span class="muted">아래 "코드 직접 붙여 넣기" 방법으로 해 주세요.</span>'}</li>
      <li><b>웹 앱으로 배포하기</b> <span class="muted">(그림을 따라 하세요)</span>
        <div class="guide">${GUIDE.map((g, k) => `
          <figure class="g-step"><figcaption><b class="g-num">${k+1}]</b><span>${g.t}</span></figcaption>
            <img src="img/setup/${g.img}.png?v=2" alt="${esc(g.alt)}" loading="lazy"></figure>`).join('')}
        </div></li>
      <li><b>웹 앱 URL 붙여 넣기</b><br>배포가 끝나면 나오는 <b>웹 앱 URL</b>을 복사해서 아래 칸에 붙여 넣어요.</li>
    </ol>
    <details><summary class="muted">사본 만들기가 안 되면: 코드 직접 붙여 넣기</summary>
      <p class="muted">새 구글 시트 → 확장 프로그램 → Apps Script → 있던 내용을 지우고 아래 코드를 붙여 넣고 저장한 뒤, 위 2번부터 하세요.</p>
      <div class="row"><button class="btn ghost small-btn" id="copyGs" type="button">코드 복사</button><span class="muted" id="copyMsg"></span></div>
      <pre class="gs" id="gs">코드를 불러오는 중…</pre></details></div>
    <label class="field" for="sheetUrl">웹 앱 URL</label>
    <input type="url" id="sheetUrl" placeholder="https://script.google.com/macros/s/.../exec">
    <label class="field" for="className">반 이름</label>
    <input type="text" id="className" placeholder="예: ○○초 5·6학년" maxlength="30">
    <div class="row"><button class="btn" id="makeClass" type="button">연결 확인하고 반 만들기</button></div>
    <p id="setupMsg" class="muted"></p>`);
  try{ gsCode = gsCode || await (await fetch('apps-script/teacher-sheet.gs')).text(); }
  catch(e){ gsCode = '코드를 불러오지 못했어요. 저장소의 apps-script/teacher-sheet.gs 파일을 열어 복사해 주세요.'; }
  if(!document.getElementById('gs')) return;
  gs.textContent = gsCode;
  copyGs.onclick = async () => { try{ await navigator.clipboard.writeText(gsCode); copyMsg.textContent = '복사했어요.'; }catch(e){ copyMsg.textContent = '직접 선택해서 복사해 주세요.'; } };
  makeClass.onclick = async () => {
    const url = sheetUrl.value.trim(), name = className.value.trim() || '우리 반';
    if(!SHEET_RE.test(url)){ setupMsg.textContent = '주소는 https://script.google.com/macros/s/ 로 시작하고 /exec 로 끝나야 해요.'; return; }
    setupMsg.textContent = '시트에 연결하는 중…';
    let sheetLink = '', ping = null;
    try{ ping = await (await fetch(url + '?action=ping')).json(); if(!ping.ok) throw 0; if(!ping.topic) throw 'old'; sheetLink = ping.sheetUrl || ''; }
    catch(e){ setupMsg.textContent = e === 'old'
      ? '시트 코드가 예전 버전이에요. 위 코드를 다시 붙여 넣고 [배포 → 배포 관리 → 새 버전]으로 다시 배포해 주세요.'
      : '시트에 연결되지 않았어요. 배포할 때 액세스를 "모든 사용자"로 했는지 확인해 주세요.'; return; }
    let code = '';
    if(CFG.REGISTRY_URL){
      try{ const r = await (await fetch(`${CFG.REGISTRY_URL}?action=register&url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`)).json(); if(r.ok) code = r.code; }catch(e){}
    }
    const key = (ping.version >= 2 && !ping.hasKey) ? await initKey(url) : '';
    LS.set('myClass', {url, name, code, sheetUrl: sheetLink, key});
    go('classReady', {}, true);
  };
};
// QR·링크에는 반 시트 주소를 직접 넣어 등록소를 거치지 않게 함 (등록소는 반코드를 손으로 칠 때만)
const classLink = mine => `${BASE}?u=${encodeURIComponent(mine.url)}&n=${encodeURIComponent(mine.name)}${mine.code ? `&c=${mine.code}` : ''}`;
VIEWS.classReady = () => {
  const mine = LS.get('myClass', null);
  if(!mine) return go('classSetup', {}, true);
  const link = classLink(mine);
  show(`<h2>${esc(mine.name)}</h2>
    <p>학생은 QR을 찍거나 링크로 들어와요.${mine.code ? ' 반코드를 직접 넣어도 돼요.' : ''} 웨일 클래스에 링크를 걸어 두면 매일 같은 링크로 선생님이 고른 오늘의 주제가 열려요.</p>
    ${mine.code ? `<div class="code-box" aria-label="반코드">${esc(mine.code)}</div>` : ''}
    <div id="qr" aria-label="반 QR 코드"></div>
    <label class="field" for="clsLink">반 링크</label>
    <input type="text" id="clsLink" readonly value="${esc(link)}">
    <div class="row">
      <button class="btn" id="copyLink" type="button">링크 복사</button>
      <a class="btn ghost" href="${esc(link)}" target="_blank" rel="noopener">학생 화면 미리 보기</a>
      ${mine.sheetUrl ? `<a class="btn ghost" href="${esc(mine.sheetUrl)}" target="_blank" rel="noopener">내 답안 시트 열기</a>` : ''}
    </div>
    <details class="panel"><summary>다른 시트로 바꾸기</summary>
      <p class="muted">이 기기에 저장된 반 정보를 지우고 새로 만들어요. 기존 시트의 답안은 그대로 남아 있어요.</p>
      <button class="btn ghost" id="resetCls" type="button">새로 만들기</button></details>`);
  drawQR(document.getElementById('qr'), link, 220);
  copyLink.onclick = async () => { try{ await navigator.clipboard.writeText(link); copyLink.textContent = '복사했어요'; }catch(e){ clsLink.select(); } };
  resetCls.onclick = () => { LS.del('myClass'); go('classSetup', {}, true); };
};
function drawQR(el, text, size){
  const draw = () => { if(window.QRCode){ el.innerHTML = ''; new QRCode(el, {text, width:size, height:size, correctLevel:QRCode.CorrectLevel.M}); } else setTimeout(draw, 300); };
  draw();
}

/* ───────── 학생 입장 ───────── */
VIEWS.codeEntry = () => {
  show(`<h2>반코드를 넣어 주세요</h2>
    <input type="text" id="codeIn" maxlength="6" placeholder="예: K7P2QM" style="font-size:28px;letter-spacing:.15em;text-transform:uppercase" autocomplete="off">
    <div class="row"><button class="btn" id="codeGo" type="button">들어가기</button></div>
    <p class="muted" id="codeMsg">${CFG.REGISTRY_URL ? '' : '선생님이 주신 QR을 찍거나 링크로 들어와요.'}</p>`);
  codeGo.onclick = async () => {
    const code = codeIn.value.trim().toUpperCase();
    if(code.length !== 6){ codeMsg.textContent = '반코드는 6글자예요.'; return; }
    if(!CFG.REGISTRY_URL){ codeMsg.textContent = '선생님께 QR이나 링크를 받아 주세요.'; return; }
    codeMsg.textContent = '찾는 중…';
    if(!(await lookupCode(code))){ codeMsg.textContent = '없는 반코드예요. 한 글자씩 다시 확인해 주세요.'; return; }
    go('nameEntry', {}, true);
  };
};
async function lookupCode(code){
  try{
    const r = await (await fetch(`${CFG.REGISTRY_URL}?action=lookup&code=${encodeURIComponent(code)}`)).json();
    if(!r.ok) return false;
    CLASS = {url:r.url, name:r.name, code:r.code}; LS.set('class', CLASS);
    return true;
  }catch(e){ return false; }
}
VIEWS.nameEntry = () => {
  const prev = LS.get('student', {number:'', name:''});
  show(`<h2>${esc(CLASS.name)}</h2>
    <p>번호와 이름을 적어 주세요. 선생님이 정해 주시면 <b>별명</b>을 써도 돼요. 답은 우리 선생님께만 가요.</p>
    <label class="field" for="stNum">번호</label><input type="number" id="stNum" min="1" max="60" value="${esc(prev.number)}" inputmode="numeric">
    <label class="field" for="stName">이름 또는 별명</label><input type="text" id="stName" maxlength="12" value="${esc(prev.name)}">
    <div class="row"><button class="btn" id="stGo" type="button">시작하기</button></div><p class="muted" id="stMsg"></p>`);
  stGo.onclick = () => {
    const number = stNum.value.trim(), name = stName.value.trim();
    if(!number || !name){ stMsg.textContent = '번호와 이름을 모두 적어 주세요.'; return; }
    STUDENT = {number, name}; LS.set('student', STUDENT);
    go('studentHome', {}, true);
  };
};

async function classTopicRank(){
  if(qs.get('r')) return Number(qs.get('r'));
  try{
    const r = await (await fetch(CLASS.url + '?action=topic')).json();
    if(r.ok && r.date === DAY.date && r.rank) return Number(r.rank);
    if(r.ok) return 0;          // 선생님이 아직 오늘 주제를 고르지 않음
  }catch(e){}
  return -1;                    // 시트에 연결하지 못함
}

VIEWS.studentHome = async () => {
  if(DAY.hidden) return hiddenDay();
  show(`<p class="muted" style="margin-top:30px">오늘의 주제를 불러오는 중이에요.</p>`);
  const rank = await classTopicRank();
  if(rank <= 0) return waitTopic(rank);
  ITEM = itemByRank(rank);
  if(!full(ITEM)) ITEM = DAY.items.find(full) || ITEM;
  tvMode = false;
  state = LS.get(`ans:${DAY.date}:${ITEM.rank}`, {});
  const done = LS.get(`done:${DAY.date}:${ITEM.rank}:${CLASS.url}`, false);
  show(`${banners(false)}
    <p>${esc(STUDENT.name)} 학생, 좋은 아침이에요.</p>
    <div class="today"><span class="tag ${ITEM.type}">${TYPE_NAME[ITEM.type]}</span>
      <h2 style="margin-top:10px">${esc(ITEM.title)}</h2>
      <p class="muted">영상 보기 3~5분, 학습지 10~15분</p>
      ${done ? '<p><b>오늘 학습지를 이미 냈어요.</b> 다시 풀어도 돼요.</p>' : ''}
      <div class="row"><button class="btn sun" id="startBtn" type="button">시작하기</button></div>
    </div>
    <p class="muted">연속 학습: <b>${streak()}일</b> · <a href="#" id="notMe">내가 아니에요</a></p>`);
  startBtn.onclick = () => go('step', {i:0, r:ITEM.rank});
  notMe.onclick = e => { e.preventDefault(); LS.del('student'); STUDENT = null; go('nameEntry'); };
};
let waitTimer = null;
function waitTopic(rank){
  clearInterval(waitTimer);
  show(`<div class="panel done-card"><div class="medal" aria-hidden="true">⏳</div>
    <h2>${rank === 0 ? '선생님이 오늘 주제를 고르면 시작해요' : '선생님 시트에 연결하지 못했어요'}</h2>
    <p class="muted">${rank === 0 ? '잠시 기다리면 저절로 시작 화면이 나와요.' : '인터넷 연결을 확인하고 다시 눌러 주세요.'}</p>
    <div class="row" style="justify-content:center"><button class="btn" id="again" type="button">다시 확인</button></div></div>`);
  again.onclick = () => VIEWS.studentHome();
  const mine = history.state;
  waitTimer = setInterval(() => {
    if(history.state !== mine || !document.getElementById('again')){ clearInterval(waitTimer); return; }
    VIEWS.studentHome();
  }, 20000);
}

function hiddenDay(){
  const prev = INDEX.find(e => !e.hidden && e.date < DAY.date);
  show(`<h2>오늘 뉴스는 쉬어 가요</h2><p>선생님 검토로 오늘 학습지는 내렸어요.</p>
    ${prev ? `<div class="row"><a class="btn" href="?date=${prev.date}${CLASS ? '&u='+encodeURIComponent(CLASS.url)+'&n='+encodeURIComponent(CLASS.name) : ''}">지난 학습지 풀기 (${prev.date})</a></div>` : ''}`);
}
function streak(){
  const set = new Set(LS.get('doneDays', []));
  let n = 0; const d = new Date(todayKST());
  for(let i=0;i<60;i++){
    const s = d.toISOString().slice(0,10), wd = d.getUTCDay();
    if(set.has(s)) n++; else if(wd !== 0 && wd !== 6 && i > 0) break;
    d.setUTCDate(d.getUTCDate()-1);
  }
  return n;
}

/* ───────── 다시 보기 (학습지 QR) ───────── */
VIEWS.review = ({r}) => {
  const it = itemByRank(r);
  show(`<p class="muted">${esc(DAY.date)} 오늘의 시사 다시 보기</p><h2>${esc(it.title)}</h2>
    ${it.video ? `<div class="video"><div id="yt"></div><div class="cover" id="vCover" hidden><div><p style="font-size:22px">영상 끝</p></div></div></div>` : ''}
    <div class="panel"><h3>쉬운 요약</h3><p>${(it.summary||[]).map(esc).join(' ')}</p></div>
    <a class="btn ghost big-link" href="${esc(it.link)}" target="_blank" rel="noopener">기사 원문 열기 (${esc(it.source)})</a>${footer()}`);
  if(it.video) mountYT(it.video.id, null);
};

/* ───────── 학습 단계 ───────── */
const STEPS = ['영상 보기','오늘의 낱말','육하원칙','핵심 활동','사실일까 의견일까','마무리'];
const saveAns = () => { if(!tvMode) LS.set(`ans:${DAY.date}:${ITEM.rank}`, state); };
VIEWS.soloHome = ({r}) => {
  ITEM = itemByRank(r); soloMode = true; tvMode = false;
  state = LS.get(`ans:${DAY.date}:${ITEM.rank}`, {});
  show(`${banners(false)}<div class="today"><span class="tag ${ITEM.type}">${TYPE_NAME[ITEM.type]}</span>
    <h2 style="margin-top:10px">${esc(ITEM.title)}</h2><p class="muted">영상 보기 3~5분, 학습지 10~15분</p>
    <div class="row"><button class="btn sun" id="startBtn" type="button">시작하기</button></div></div>`);
  startBtn.onclick = () => go('step', {i:0, r:ITEM.rank});
};

VIEWS.step = ({i, r, tv}) => {
  if(!ITEM || ITEM.rank !== Number(r)) ITEM = itemByRank(r);
  tvMode = !!tv;
  if(!tvMode && !soloMode && !(CLASS && STUDENT)) return go('home', {}, true);
  const it = ITEM;
  const bar = `<div class="progress" aria-hidden="true">${STEPS.map((_,k) => `<i class="${k<i?'done':k===i?'on':''}"></i>`).join('')}</div>
    <p class="step-name">${i+1} / ${STEPS.length} · ${STEPS[i]}${tvMode ? ' · TV 화면' : ''}</p>`;
  const nav = (canNext = true, label = '다음') => `<div class="nav">
    ${i>0 ? `<button class="btn ghost" id="prev" type="button">이전</button>` : '<span></span>'}
    <button class="btn" id="next" type="button" ${canNext?'':'disabled'}>${label}</button></div>`;
  const toStep = k => go('step', {i:k, r:it.rank, tv: tvMode ? 1 : 0});
  const bindNav = () => {
    const p = document.getElementById('prev'), n = document.getElementById('next');
    if(p) p.onclick = () => toStep(i-1);
    if(n) n.onclick = () => toStep(i+1);
  };
  const origin = `<a class="btn ${tvMode ? 'sun big-link' : 'ghost small-btn'}" href="${esc(it.link)}" target="_blank" rel="noopener">기사 원문 열기 (${esc(it.source)})</a>`;

  if(i === 0){
    show(bar + `<h2>${esc(it.title)}</h2>` + (it.video
      ? `<div class="video"><div id="yt"></div>
          <div class="cover" id="vCover" hidden><div><p style="font-size:22px">영상을 다 봤어요</p><button class="btn sun" id="toSheet" type="button">학습지 시작하기</button></div></div></div>
          <p class="muted">${esc(it.video.channel)} 공식 채널 영상 · 영상이 안 나오면 아래 원문을 보세요.</p><div class="row">${origin}</div>`
      : `<div class="panel"><h3>${tvMode ? '오늘은 맞는 영상이 없어요. 기사 원문을 함께 보거나 요약을 읽어요.' : '오늘은 영상 대신 요약을 먼저 읽어요'}</h3>
          <p>${(it.summary||[]).map(esc).join(' ')}</p></div><div class="row">${origin}</div>`) + nav());
    if(it.video) mountYT(it.video.id, () => toStep(1));
    return bindNav();
  }

  if(i === 1){
    state.words = state.words || {};
    const words = it.words || [];
    show(bar + `<h2>뜻을 골라 보세요</h2>` + words.map((w, wi) => {
      const opts = shuffleSeeded([w.meaning, ...(w.wrong||[])], DAY.date + w.word);
      const picked = state.words[wi];
      return `<div class="panel"><h3>${esc(w.word)}</h3><div class="opts">${opts.map(o => {
        let cls = 'opt';
        if(picked !== undefined){ if(o === w.meaning) cls += ' right'; else if(o === picked) cls += ' wrong'; }
        return `<button class="${cls}" data-w="${wi}" data-o="${esc(o)}" type="button" ${picked!==undefined?'disabled':''}>${esc(o)}</button>`;
      }).join('')}</div></div>`;
    }).join('') + nav(Object.keys(state.words).length === words.length));
    document.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { state.words[b.dataset.w] = b.dataset.o; saveAns(); keepScroll(() => VIEWS.step({i, r, tv})); });
    return bindNav();
  }

  if(i === 2){
    state.w5 = state.w5 || {};
    const fw = it.five_w || {}, checked = !!state.w5done;
    show(bar + `<h2>육하원칙을 직접 써 보세요</h2>
      <p class="muted">영상과 요약에서 찾아 써요. 기사에 없으면 '기사에 없음'이라고 써도 돼요. 다 쓰고 <b>확인하기</b>를 누르면 기사와 비교할 수 있어요.</p>
      <details class="panel"><summary>요약 다시 보기</summary><p>${(it.summary||[]).map(esc).join(' ')}</p></details>
      <div class="panel"><div class="w5in">${Object.keys(W6).map(k => `<div>
        <label for="w5_${k}">${W6[k]}</label>
        <input id="w5_${k}" data-w5="${k}" type="text" maxlength="40" value="${esc(state.w5[k]||'')}" ${checked?'readonly':''} placeholder="${tvMode ? '함께 말해 봐요' : ''}">
        ${checked ? `<div class="ans">기사: ${esc(fw[k])}</div>` : ''}</div>`).join('')}</div>
        <div class="row">${checked
          ? `<span class="muted">내 답과 기사를 비교해 보세요. 달라도 괜찮아요.</span><button class="btn ghost small-btn" id="w5Again" type="button">다시 쓰기</button>`
          : `<button class="btn sun" id="w5Check" type="button">확인하기</button><span class="muted" id="w5Msg"></span>`}</div>
      </div>` + nav(checked || tvMode));
    const allFilled = () => Object.keys(W6).every(k => (state.w5[k]||'').trim());
    document.querySelectorAll('[data-w5]').forEach(inp => inp.oninput = () => { state.w5[inp.dataset.w5] = inp.value; saveAns(); });
    const chk = document.getElementById('w5Check');
    if(chk) chk.onclick = () => {
      if(!tvMode && !allFilled()){ w5Msg.textContent = '빈 칸을 모두 채워 주세요.'; return; }
      state.w5done = true; saveAns(); keepScroll(() => VIEWS.step({i, r, tv}));
    };
    const again = document.getElementById('w5Again');
    if(again) again.onclick = () => { state.w5done = false; saveAns(); VIEWS.step({i, r, tv}); };
    return bindNav();
  }

  if(i === 3){ activityStep(bar, nav); return bindNav(); }

  if(i === 4){
    state.fo = state.fo || {};
    const fo = it.facts_opinions || [];
    show(bar + `<h2>사실일까, 의견일까?</h2><p class="muted">사실은 확인할 수 있는 일, 의견은 사람마다 다를 수 있는 생각이에요.</p>` + fo.map((f, k) => {
      const p = state.fo[k];
      return `<div class="fo"><div>${esc(f.sentence)}</div>
        <div class="row"><button type="button" class="f ${p==='사실'?'sel':''}" data-f="${k}" data-v="사실" ${p?'disabled':''}>사실</button>
        <button type="button" class="o ${p==='의견'?'sel':''}" data-f="${k}" data-v="의견" ${p?'disabled':''}>의견</button></div>
        ${p ? `<div class="why">${p===f.answer ? '맞아요.' : `정답은 <b>${esc(f.answer)}</b>이에요.`} ${esc(f.reason)}</div>` : ''}</div>`;
    }).join('') + nav(Object.keys(state.fo).length === fo.length));
    document.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { state.fo[b.dataset.f] = b.dataset.v; saveAns(); keepScroll(() => VIEWS.step({i, r, tv})); });
    return bindNav();
  }

  if(i === 5){ finishStep(bar, toStep); }
};
function keepScroll(fn){ const y = window.scrollY; fn(); window.scrollTo({top:y}); }

function writeBox(k, q, bare){
  const inner = `<p><b>✏️ ${esc(q)}</b></p><textarea data-wr="${k}" placeholder="${tvMode ? '함께 이야기 나눠요' : '여기에 써요'}">${esc(state[k]||'')}</textarea>`;
  return bare ? inner : `<div class="panel">${inner}</div>`;
}
const bindWrites = () => document.querySelectorAll('[data-wr]').forEach(t => t.oninput = () => { state[t.dataset.wr] = t.value; saveAns(); });

function activityStep(bar, nav){
  const it = ITEM, a = it.activity || {};
  let body = '';
  if(it.type === 'useful') body = `<h2>이 뉴스, 나와 어떤 관계가 있을까?</h2>` + writeBox('impact_question', a.impact_question) + writeBox('wonder_question', a.wonder_question);
  if(it.type === 'debate'){
    const side = s => `<button type="button" class="side ${s} ${state.side===s?'picked':''}" data-side="${s}">
      <b>${esc(a['side_'+s].title)}</b><ul>${(a['side_'+s].reasons||[]).map(x => `<li>${esc(x)}</li>`).join('')}</ul></button>`;
    body = `<h2>${esc(a.issue)}</h2><p class="muted">두 입장 모두 이유가 있어요. 내 생각과 가까운 쪽을 눌러요.</p>
      <div class="sides">${side('a')}${side('b')}</div>` + writeBox('choose_question', a.choose_question) + writeBox('other_side_question', a.other_side_question);
  }
  if(it.type === 'media'){
    body = `<h2>같은 사건, 다른 제목</h2>
      <div class="heads">${(it.headlines||[]).map(h => `<div class="head"><small>${esc(h.source)}</small>${esc(h.title)}</div>`).join('')}</div>
      <div class="panel"><p><b>제목들이 주는 느낌은 어떤가요?</b></p><div class="opts">${(a.feeling_choices||[]).map(c =>
        `<button type="button" class="opt ${state.feeling===c?'picked':''}" data-feel="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>` +
      writeBox('why_question', a.why_question) + writeBox('rewrite_question', a.rewrite_question);
  }
  show(bar + body + nav());
  bindWrites();
  const re = () => keepScroll(() => VIEWS.step(history.state.params));
  document.querySelectorAll('[data-side]').forEach(b => b.onclick = () => { state.side = b.dataset.side; saveAns(); re(); });
  document.querySelectorAll('[data-feel]').forEach(b => b.onclick = () => { state.feeling = b.dataset.feel; saveAns(); re(); });
}

function collectAnswers(){
  const it = ITEM, a = it.activity || {};
  const out = [];
  const push = (q, v) => { if(q) out.push({q, a: v || ''}); };
  push('육하원칙', Object.keys(W6).map(k => `${W6[k]}: ${(state.w5||{})[k] || ''}`).join(' / '));
  if(it.type === 'useful'){ push(a.impact_question, state.impact_question); push(a.wonder_question, state.wonder_question); }
  if(it.type === 'debate'){
    const pick = state.side ? a['side_'+state.side].title : '(고르지 않음)';
    push(a.choose_question, `[${pick}] ${state.choose_question||''}`);
    push(a.other_side_question, state.other_side_question);
  }
  if(it.type === 'media'){ push('제목이 주는 느낌', state.feeling); push(a.why_question, state.why_question); push(a.rewrite_question, state.rewrite_question); }
  if(it.challenge && state.challenge) push('[도전] ' + it.challenge, state.challenge);
  return out.slice(0, 5);
}
function scores(){
  const it = ITEM;
  const w = (it.words||[]).filter((x,k) => state.words && state.words[k] === x.meaning).length;
  const f = (it.facts_opinions||[]).filter((x,k) => state.fo && state.fo[k] === x.answer).length;
  return {w, wn:(it.words||[]).length, f, fn:(it.facts_opinions||[]).length};
}
function challengeBox(){
  const it = ITEM;
  if(!it.challenge) return '';
  if(tvMode) return `<div class="panel"><p class="muted">더 생각해 보기 (6학년 도전)</p><p><b>${esc(it.challenge)}</b></p></div>`;
  return `<details class="panel" ${state.challenge?'open':''}><summary><b>도전 문항</b> (6학년이나 빨리 끝낸 친구, 선택)</summary>${writeBox('challenge', it.challenge, true)}</details>`;
}
function finishStep(bar, toStep){
  const s = scores();
  if(soloMode){
    show(bar + challengeBox() + `<div class="panel done-card"><div class="medal" aria-hidden="true">☀️</div><h2>오늘의 시사 끝!</h2>
      <p>낱말 ${s.w}/${s.wn} · 사실·의견 ${s.f}/${s.fn}</p><p class="muted">쓴 내용은 선생님께 말로 나눠 보세요.</p>
      <div class="row" style="justify-content:center"><button class="btn ghost" id="prev" type="button">이전</button></div></div>`);
    bindWrites();
    prev.onclick = () => toStep(4);
    return;
  }
  if(tvMode){
    show(bar + challengeBox() + `<div class="panel done-card"><div class="medal" aria-hidden="true">☀️</div><h2>오늘의 시사 끝!</h2>
      <div class="row" style="justify-content:center"><button class="btn ghost" id="prev" type="button">이전</button>
      <button class="btn" id="back" type="button">선생님 화면으로</button></div></div>`);
    prev.onclick = () => toStep(4);
    back.onclick = () => go('teacherHome');
    return;
  }
  const ans = collectAnswers();
  const empty = ans.filter(x => !x.a.trim() || x.a.endsWith('] ')).length;
  show(bar + `<h2>선생님께 보내기</h2>${challengeBox()}
    <div class="panel"><p>낱말 <b>${s.w}/${s.wn}</b> · 사실·의견 <b>${s.f}/${s.fn}</b></p>
    ${ans.map(x => `<p class="muted">${esc(x.q)}</p><div class="answer">${esc(x.a) || '<i>비어 있어요</i>'}</div>`).join('')}</div>
    ${empty ? `<p class="muted">빈 칸이 ${empty}개 있어요. 그래도 보낼 수 있어요.</p>` : ''}
    <div class="nav"><button class="btn ghost" id="prev" type="button">고치러 가기</button>
    <button class="btn sun" id="send" type="button">${esc(CLASS.name)} 선생님께 보내기</button></div>
    <p class="muted" id="sendMsg"></p>`);
  bindWrites();
  prev.onclick = () => toStep(4);
  send.onclick = () => submit(collectAnswers(), s);
}
async function submit(ans, s){
  send.disabled = true; sendMsg.textContent = '보내는 중…';
  const it = ITEM, OX = b => b ? '○' : '×';
  const wOK = (it.words||[]).map((x,k) => !!(state.words && state.words[k] === x.meaning));
  const fOK = (it.facts_opinions||[]).map((x,k) => !!(state.fo && state.fo[k] === x.answer));
  const detail = {v:1, rank:it.rank, words:wOK, fo:fOK, side:state.side || '', feeling:state.feeling || '', w5:state.w5 || {},
    writes:Object.fromEntries(['impact_question','wonder_question','choose_question','other_side_question','why_question','rewrite_question','challenge']
      .filter(k => state[k]).map(k => [k, String(state[k]).slice(0, 500)]))};
  const payload = JSON.stringify({app:'today-news', date:DAY.date, title:`[${it.rank}순위] ${it.title}`, number:STUDENT.number, name:STUDENT.name,
    words_score:`${s.w}/${s.wn} ${wOK.map(OX).join('')}`, fo_score:`${s.f}/${s.fn} ${fOK.map(OX).join('')}`, answers:ans, detail});
  let ok = false;
  try{ const j = await (await fetch(CLASS.url, {method:'POST', body:payload})).json(); ok = !!j.ok; }
  catch(e){ try{ await fetch(CLASS.url, {method:'POST', body:payload, mode:'no-cors'}); ok = true; }catch(e2){} }
  if(!ok){ send.disabled = false; sendMsg.textContent = '보내지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요. (쓴 답은 이 기기에 남아 있어요)'; return; }
  LS.set(`done:${DAY.date}:${ITEM.rank}:${CLASS.url}`, true);
  const days = new Set(LS.get('doneDays', [])); days.add(DAY.date); LS.set('doneDays', [...days].slice(-120));
  go('sent', {}, true);
}
VIEWS.sent = () => {
  const n = streak();
  show(`<div class="panel done-card"><div class="medal" aria-hidden="true">${n>=10?'🏅':n>=5?'⭐':'☀️'}</div>
    <h2>잘 보냈어요!</h2><p>연속 학습 <b>${n}일</b>째예요.${n===5?' 5일 연속 별을 받았어요!':''}${n===10?' 10일 연속 메달을 받았어요!':''}</p>
    <div class="row" style="justify-content:center"><button class="btn ghost" id="back" type="button">처음으로</button></div></div>`);
  back.onclick = () => go('studentHome');
};

/* ───────── 유튜브 (끝나면 추천 영상 대신 덮개) ───────── */
function mountYT(id, onDone){
  const start = () => {
    if(!document.getElementById('yt')) return;
    new YT.Player('yt', {
      host:'https://www.youtube-nocookie.com', videoId:id,
      playerVars:{rel:0, modestbranding:1, playsinline:1, iv_load_policy:3, fs:1},
      events:{onStateChange: e => {
        const cover = document.getElementById('vCover'); if(!cover) return;
        if(e.data === YT.PlayerState.ENDED) cover.hidden = false;
        if(e.data === YT.PlayerState.PLAYING) cover.hidden = true;
      }}
    });
    const ts = document.getElementById('toSheet'); if(ts && onDone) ts.onclick = onDone;
  };
  if(window.YT && window.YT.Player) return start();
  window.onYouTubeIframeAPIReady = start;
  if(!document.getElementById('ytapi')){
    const s = document.createElement('script'); s.id = 'ytapi'; s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { const v = document.querySelector('.video'); if(v) v.outerHTML = `<div class="panel"><p>이 기기에서는 영상이 열리지 않아요. 아래 원문이나 요약을 봐 주세요.</p></div>`; };
    document.head.appendChild(s);
  }
}
function shuffleSeeded(arr, seed){
  let h = 0; for(const c of seed) h = (h*31 + c.charCodeAt(0)) >>> 0;
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){ h = (h*1103515245 + 12345) >>> 0; const j = h % (i+1); [a[i],a[j]] = [a[j],a[i]]; }
  return a;
}

/* ───────── 인쇄 (A4 한 장 + 다시 보기 QR) ───────── */
async function qrDataURL(text){
  const tmp = document.getElementById('qrTmp');
  for(let k=0; k<20 && !window.QRCode; k++) await new Promise(r => setTimeout(r, 150));
  if(!window.QRCode) return '';
  tmp.innerHTML = '';
  new QRCode(tmp, {text, width:256, height:256, correctLevel:QRCode.CorrectLevel.M});
  const c = tmp.querySelector('canvas');
  return c ? c.toDataURL('image/png') : '';
}
async function printSheet(it, withAnswers){
  const a = it.activity || {}, t = it.teacher || {};
  const lines = n => Array.from({length:n}, () => '<div class="lines"></div>').join('');
  const L3 = {who:'누가', what:'무엇을', why:'왜'};
  const qr = await qrDataURL(reviewLink(it));
  let act = '';
  if(it.type === 'useful') act = `<b class="t">③ 나와 어떤 관계가 있을까?</b>
      <p class="q">✏️ ${esc(a.impact_question)}</p>${lines(2)}<p class="q">✏️ ${esc(a.wonder_question)}</p>${lines(2)}`;
  if(it.type === 'debate') act = `<b class="t">③ ${esc(a.issue)}</b>
      <div class="two">${['a','b'].map(s => `<div class="side-p"><b>□ ${esc(a['side_'+s].title)}</b><br>${(a['side_'+s].reasons||[]).map(esc).join(' ')}</div>`).join('')}</div>
      <p class="q">✏️ ${esc(a.choose_question)}</p>${lines(2)}<p class="q">✏️ ${esc(a.other_side_question)}</p>${lines(2)}`;
  if(it.type === 'media') act = `<b class="t">③ 같은 사건, 다른 제목</b>
      <table>${(it.headlines||[]).map(h => `<tr><td style="width:20%">${esc(h.source)}</td><td>${esc(h.title)}</td></tr>`).join('')}</table>
      <p>제목들의 느낌에 ○ 하세요: ${(a.feeling_choices||[]).map(c => `(　) ${esc(c)}`).join('　')}</p>
      <p class="q">✏️ ${esc(a.why_question)}</p>${lines(2)}<p class="q">✏️ ${esc(a.rewrite_question)}</p>${lines(2)}`;
  let html = `${qr ? `<div class="qr"><img src="${qr}" alt="">뉴스 다시 보기</div>` : ''}<h1>${esc(it.title)}</h1>
    <div class="meta"><span>오늘의 시사 · ${esc(DAY.date)} · 출처 ${esc(it.source)} (새로 쓴 요약, AI 생성)</span><span>____학년 ____번 이름: ________</span></div>
    <div class="box" style="clear:both"><b class="t">① 오늘의 낱말 — 알맞은 뜻에 ○ 하세요</b>
      <table>${(it.words||[]).map(w => `<tr><td style="width:16%"><b>${esc(w.word)}</b></td><td>${shuffleSeeded([w.meaning,...(w.wrong||[])], DAY.date+w.word).map(o=>`(　) ${esc(o)}`).join('　　')}</td></tr>`).join('')}</table></div>
    <div class="box"><b class="t">② 읽고 채우기</b><p>${(it.summary||[]).map(esc).join(' ')}</p>
      <table class="w3"><tr>${Object.values(L3).map(v=>`<th>${v}</th>`).join('')}</tr><tr>${Object.keys(L3).map(()=>'<td></td>').join('')}</tr></table>
      <p class="small">기사에 없으면 '기사에 없음'이라고 써요.</p></div>
    <div class="box">${act}</div>
    <div class="box"><b class="t">④ 사실이면 '사', 의견이면 '의'</b>
      <table>${(it.facts_opinions||[]).map(f=>`<tr><td>${esc(f.sentence)}</td><td style="width:14mm"></td></tr>`).join('')}</table></div>`;
  if(withAnswers){
    html += `<div class="pb"></div><h1>정답과 예시 답안</h1>
      <div class="box"><b class="t">낱말</b>${(it.words||[]).map(w=>`<p>${esc(w.word)}: ${esc(w.meaning)}</p>`).join('')}</div>
      <div class="box"><b class="t">육하원칙</b><table><tr>${Object.values(W6).map(v=>`<th>${v}</th>`).join('')}</tr><tr>${Object.keys(W6).map(k=>`<td>${esc((it.five_w||{})[k])}</td>`).join('')}</tr></table></div>
      <div class="box"><b class="t">사실·의견</b>${(it.facts_opinions||[]).map(f=>`<p>${esc(f.sentence)} → <b>${esc(f.answer)}</b> (${esc(f.reason)})</p>`).join('')}</div>
      <div class="box"><b class="t">예시 답안</b>${Object.entries(t.sample_answers||{}).map(([k,v])=>`<p><b>${esc(questionLabel(it,k))}</b><br>${esc(v)}</p>`).join('')}</div>
      <div class="box"><b class="t">더 물어볼 질문 · 주의할 점</b>${(t.extra_questions||[]).map(q=>`<p>· ${esc(q)}</p>`).join('')}${(t.cautions||[]).map(q=>`<p>※ ${esc(q)}</p>`).join('')}</div>
      <div class="box"><b class="t">교과 연계</b>${(it.curriculum||[]).map(c=>`<p>${esc(c)}</p>`).join('')}</div>`;
  }
  document.getElementById('print').innerHTML = html;
  setTimeout(() => window.print(), 150);
}

/* ───────── 지난 학습지 ───────── */
VIEWS.archive = () => {
  const list = INDEX.filter(e => !e.hidden);
  show(`<h2>지난 학습지</h2>${list.length ? `<ul class="archive">${list.map(e => `<li><a href="?date=${e.date}${CLASS ? '&u='+encodeURIComponent(CLASS.url)+'&n='+encodeURIComponent(CLASS.name) : ''}">${e.date}</a> · ${esc((e.titles||[e.title]).join(' / '))}</li>`).join('')}</ul>` : '<p class="muted">아직 쌓인 학습지가 없어요.</p>'}`);
};

/* ───────── 시작 ───────── */
async function boot(){
  try{
    try{ INDEX = await getJSON('data/index.json'); }catch(e){ INDEX = []; }
    DAY = normalize(await getJSON(qs.get('date') ? `data/archive/${qs.get('date')}.json` : 'data/today.json'));
  }catch(e){ show(`<h2>학습지를 불러오지 못했어요</h2><p>잠시 뒤 새로고침해 주세요. 계속 안 되면 선생님께 알려 주세요.</p>`); return; }
  setStamp(DAY.date);
  document.getElementById('brandTitle').textContent = CFG.SITE_TITLE || '오늘의 시사';

  // 학습지 QR로 들어온 '다시 보기'
  if(qs.get('v') && qs.get('r')) return go('review', {r:Number(qs.get('r'))}, true);
  // 반 없이 선생님 QR로 들어온 '혼자 풀기'
  if(qs.get('solo') && qs.get('r')) return go('soloHome', {r:Number(qs.get('r'))}, true);

  // 학생 링크(QR)로 들어온 경우
  const c = qs.get('c'), u = qs.get('u');
  if(u && SHEET_RE.test(u)){
    CLASS = {url:u, name:qs.get('n') || '우리 반', code:(c || '').toUpperCase()}; LS.set('class', CLASS);
  } else if(c && CFG.REGISTRY_URL){
    const saved = LS.get('class', null);
    if(saved && saved.code === c.toUpperCase()) CLASS = saved;
    else if(!(await lookupCode(c.toUpperCase()))){ show(`<h2>반을 찾지 못했어요</h2><p>선생님께 새 링크를 받아 주세요.</p>`); return; }
  }
  if(CLASS){
    const st = LS.get('student', null);
    if(st && st.number && st.name){ STUDENT = st; return go('studentHome', {}, true); }
    return go('nameEntry', {}, true);
  }
  if(DAY.hidden && !qs.get('date')) return hiddenDay();
  go('home', {}, true);
}
boot();
})();
