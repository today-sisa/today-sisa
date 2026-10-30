// 오늘의 시사 — 사이트 설정
// REGISTRY_URL: 반코드 등록소(apps-script/class-registry.gs) 웹 앱 주소.
//   비워 두면 반코드 대신 QR·링크로만 들어옵니다. (그래도 답안 수집은 됩니다)
// TEACHER_PASS_SHA256: '선생님' 화면 비밀번호를 암호화한 값입니다. (비밀번호 글자를 그대로 넣지 않습니다)
//   비밀번호를 바꾸려면 Claude에게 "교사 비밀번호를 ○○로 바꿔줘"라고 하거나,
//   https://emn178.github.io/online-tools/sha256.html 에 새 비밀번호를 넣고 나온 값을 아래에 붙여 넣으세요.
window.TODAY_NEWS_CONFIG = {
  REGISTRY_URL: "https://script.google.com/macros/s/AKfycbzZd-wBvWwYB-zVUaUQDtct4TqvjnkB2iPlzusf_hDI6HvZEP_GulG0ycsZj6lsgjteig/exec",
  SITE_TITLE: "오늘의 시사",
  GRADE: "5·6학년",
  // 선생님들이 '반 만들기'에서 복사하는 답안 시트 원본 (코드가 들어 있는 시트, 링크가 있는 모든 사용자 보기)
  TEMPLATE_SHEET_COPY_URL: "https://docs.google.com/spreadsheets/d/1YXdQWr1SFtehRYtI0EkrXRnaxdhOGhk8SSXRIrXUrTw/copy",
  // 홈 화면 "○○명의 선생님이 함께" 표시: 선생님 수가 이 숫자 이상일 때만 보여요
  STATS_MIN: 10,
  TEACHER_PASS_SHA256: "b6408dfac4a551b5b184c06e86ae62ee5af7b9af39249edfa95f90dc23b96149"
};
