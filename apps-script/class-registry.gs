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
 */

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
const feedback_ = () => tab_('의견', ['보낸 시각', '뉴스 날짜', '이유', '메모']);

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

    if (action === 'feedback') {
      feedback_().appendRow([new Date(), String(p.date || '').slice(0, 12),
        String(p.reason || '').slice(0, 40), String(p.memo || '').slice(0, 300)]);
      return out_({ ok: true });
    }

    return out_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}
