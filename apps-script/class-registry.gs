/**
 * 오늘의 시사 — 반코드 등록소 (운영자 1명만 설치)
 * ------------------------------------------------------------
 * 하는 일: 반코드(6자리) ↔ 각 선생님 답안 시트 주소를 짝지어 둡니다.
 *          학생 답안은 여기 오지 않습니다. 반 이름과 시트 주소만 저장됩니다.
 *          선생님들이 '숨기기 이유'를 보내면 '의견' 탭에 쌓입니다.
 *
 * 설치: 새 구글 시트 → [확장 프로그램] → [Apps Script] → 이 코드 붙여 넣기 → 저장
 *       → [배포] → [새 배포] → 웹 앱 / 실행: 나 / 액세스: 모든 사용자 → 배포
 *       → 나온 웹 앱 URL을 사이트의 config.js 의 REGISTRY_URL 에 넣습니다.
 *
 * '개발자에게' 건의가 오면 '의견' 탭에 쌓이고 NOTIFY_EMAIL 로 메일이 갑니다.
 * 코드를 바꾼 뒤에는 [배포 → 배포 관리 → 연필 → 버전: 새 버전 → 배포]를 하고,
 * 메일 보내기 권한을 처음 한 번 허용해야 합니다. (편집기에서 testMail 실행 → 권한 허용)
 */

const NOTIFY_EMAIL = 'bohwan96@naver.com';   // 건의 알림을 받을 메일 (비우면 메일 안 보냄)

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0,O,1,I 제외

function tab_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}
const classes_ = () => tab_('반', ['반코드', '시트 주소', '반 이름', '학교', '만든 날']);
const teachers_ = () => tab_('선생님', ['기기 번호', '처음 온 날', '방식']);
const feedback_ = () => tab_('의견', ['보낸 시각', '뉴스 날짜', '종류', '내용', '연락처', '화면']);

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function newCode_(existing) {
  for (let t = 0; t < 50; t++) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!existing.has(c)) return c;
  }
  throw new Error('코드 생성 실패');
}

/** 건의 메일 (하루 최대 30통까지만, 장난 폭주 방지) */
function notify_(kind, text, contact, page) {
  if (!NOTIFY_EMAIL || !text) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    const key = 'mail_' + today;
    const n = Number(props.getProperty(key) || 0);
    if (n >= 30) return;
    props.setProperty(key, String(n + 1));
    MailApp.sendEmail(NOTIFY_EMAIL, '[오늘의 시사] ' + (kind || '의견') + ' 도착',
      '종류: ' + kind + '\n내용:\n' + text + '\n\n연락처: ' + (contact || '-') + '\n화면: ' + (page || '-') +
      '\n\n모든 의견은 등록소 시트의 \'의견\' 탭에 있습니다.\n' + SpreadsheetApp.getActiveSpreadsheet().getUrl());
  } catch (err) { /* 메일 권한이 없으면 시트에만 저장 */ }
}

/** 편집기에서 한 번 실행해 메일 권한을 허용하세요 */
function testMail() {
  MailApp.sendEmail(NOTIFY_EMAIL, '[오늘의 시사] 메일 알림 시험', '건의 알림이 이 메일로 옵니다.');
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || 'ping';
  try {
    if (action === 'ping') return out_({ ok: true, app: 'today-news-registry' });

    if (action === 'register') {
      const url = String(p.url || '').trim();
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
        return out_({ ok: false, error: '시트 주소 형식이 아닙니다.' });
      }
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        const sh = classes_();
        const rows = sh.getDataRange().getValues().slice(1);
        // 같은 시트 주소가 이미 있으면 기존 코드 돌려주기
        const same = rows.find(r => r[1] === url);
        if (same) {
          return out_({ ok: true, code: same[0], name: same[2], school: same[3] });
        }
        const code = newCode_(new Set(rows.map(r => r[0])));
        const name = String(p.name || '').slice(0, 30);
        const school = String(p.school || '').slice(0, 30);
        sh.appendRow([code, url, name, school, new Date()]);
        return out_({ ok: true, code: code, name: name, school: school });
      } finally {
        lock.releaseLock();
      }
    }

    if (action === 'lookup') {
      const code = String(p.code || '').trim().toUpperCase();
      const r = classes_().getDataRange().getValues().slice(1).find(x => x[0] === code);
      if (!r) return out_({ ok: false, error: '없는 반코드입니다.' });
      return out_({ ok: true, code: r[0], url: r[1], name: r[2], school: r[3] });
    }

    if (action === 'hello') {  // 선생님 기기가 처음 들어올 때 한 번 (숫자 세기용, 개인 정보 없음)
      const id = String(p.id || '').slice(0, 40);
      if (!/^[A-Za-z0-9]{8,40}$/.test(id)) return out_({ ok: false });
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        const sh = teachers_();
        const found = sh.getLastRow() > 1 && sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
        if (!found) {
          sh.appendRow([id, new Date(), String(p.mode || '').slice(0, 10)]);
          CacheService.getScriptCache().remove('stats');
        }
      } finally { lock.releaseLock(); }
      return out_({ ok: true });
    }

    if (action === 'stats') {  // 홈 화면 "○○명의 선생님, ○○개 반" 표시용
      const cache = CacheService.getScriptCache();
      const hit = cache.get('stats');
      if (hit) return out_(JSON.parse(hit));
      const res = { ok: true, teachers: Math.max(teachers_().getLastRow() - 1, 0), classes: Math.max(classes_().getLastRow() - 1, 0) };
      cache.put('stats', JSON.stringify(res), 600);
      return out_(res);
    }

    if (action === 'feedback') {
      const kind = String(p.kind || p.reason || '').slice(0, 40);
      const text = String(p.text || p.memo || '').slice(0, 1000);
      const contact = String(p.contact || '').slice(0, 100);
      const page = String(p.page || '').slice(0, 200);
      feedback_().appendRow([new Date(), String(p.date || '').slice(0, 12), kind, text, contact, page]);
      notify_(kind, text, contact, page);
      return out_({ ok: true });
    }

    return out_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}
