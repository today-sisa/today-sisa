/**
 * 오늘의 시사 — 선생님 답안 시트 코드
 * ------------------------------------------------------------
 * 사용법 (5분)
 * 1. 구글 시트를 새로 하나 만듭니다. (이름 예: 오늘의 시사 답안 - 6학년 1반)
 * 2. 메뉴 [확장 프로그램] → [Apps Script]를 엽니다.
 * 3. 원래 있던 내용을 모두 지우고, 이 파일 전체를 붙여 넣고 저장(💾)합니다.
 * 4. 오른쪽 위 [배포] → [새 배포] → 톱니바퀴에서 [웹 앱] 선택
 *      - 다음 사용자 인증 정보로 실행: 나
 *      - 액세스 권한이 있는 사용자: 모든 사용자
 *    [배포]를 누르고 권한을 허용합니다. ("확인되지 않은 앱" 화면이 나오면
 *    [고급] → [(안전하지 않음)으로 이동]을 누르세요. 내가 만든 코드라 괜찮습니다.)
 * 5. 나온 [웹 앱 URL](https://script.google.com/macros/s/.../exec)을 복사해서
 *    오늘의 시사 사이트의 '학생과 함께 할래요' 화면에 붙여 넣습니다.
 *
 * 학생 답은 이 시트에만 저장됩니다. 다른 곳에는 모이지 않습니다.
 * 코드를 고친 뒤에는 [배포] → [배포 관리] → 연필 → 버전 '새 버전'으로 다시 배포하세요.
 */

const SHEET_NAME = '답안';
const HEADERS = ['제출 시각', '뉴스 날짜', '뉴스 제목', '번호', '이름', '낱말 (맞힌 수)', '사실·의견 (맞힌 수)',
  '질문1', '답1', '질문2', '답2', '질문3', '답3', '질문4', '답4', '질문5', '답5'];
const MAX_LEN = 1500;

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#eef3f8');
    sh.setColumnWidths(8, 10, 220);
  }
  return sh;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function clip_(v) {
  return String(v == null ? '' : v).slice(0, MAX_LEN);
}

/** 연결 확인용 */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'ping';
  if (action === 'ping') {
    sheet_();
    return out_({ ok: true, app: 'today-news', sheet: SpreadsheetApp.getActiveSpreadsheet().getName() });
  }
  return out_({ ok: false, error: 'unknown action' });
}

/** 학생 답안 받기 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents || '{}');
    if (d.app !== 'today-news') return out_({ ok: false, error: 'bad app' });
    const row = [
      new Date(), clip_(d.date), clip_(d.title), clip_(d.number), clip_(d.name),
      clip_(d.words_score), clip_(d.fo_score)
    ];
    const qa = Array.isArray(d.answers) ? d.answers.slice(0, 5) : [];
    for (let i = 0; i < 5; i++) {
      row.push(clip_(qa[i] ? qa[i].q : ''), clip_(qa[i] ? qa[i].a : ''));
    }
    sheet_().appendRow(row);
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
