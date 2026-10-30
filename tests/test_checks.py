"""검사 기능 테스트: python3 tests/test_checks.py"""
import copy, json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import generate as g

cfg = g.load_config()
ws = json.loads((ROOT / "tests/fixtures/worksheet.json").read_text(encoding="utf-8"))
pick = {"type": "debate"}
src = (ROOT / "tests/fixtures/body.txt").read_text(encoding="utf-8")

assert g.check_worksheet(cfg, ws, pick, src) == [], g.check_worksheet(cfg, ws, pick, src)

bad = copy.deepcopy(ws)
bad["main"]["summary"][0] = "학생 1500명 조사에서 72%가 찬성했어요."
bad["main"]["summary"][1] = "이 문장은 아이들이 읽기에는 너무 길어서 자동 검사에서 걸러져야 하는 문장입니다."
bad["main"]["words"] = bad["main"]["words"][:1]
bad["main"]["activity"]["side_b"]["reasons"] = ["하나", "둘"]
bad["main"]["challenge"] = "살인 사건을 생각해 보세요"
probs = g.check_worksheet(cfg, bad, pick, src)
print("\n".join(probs))
assert any("1500" in p for p in probs) and any("72" in p for p in probs)
assert any("낱말" in p for p in probs) and any("side_b" in p for p in probs) and any("금지어" in p for p in probs)
assert any("요약 문장" in p and "너무 김" in p for p in probs)

# 선정 검증: 없는 번호, 같은 분야 3개, 언론사 1곳짜리 media
cands = [{"id": i, "source": s, "title": f"기사{i}", "desc": "", "link": f"https://x/{i}", "via": "direct"}
         for i, s in enumerate(["연합뉴스", "SBS", "YTN", "KBS", "MBC", "JTBC", "연합뉴스"])]
raw = {"picks": [
    {"rank": 1, "members": [0, 1], "main": 0, "category": "사회", "type": "media"},
    {"rank": 2, "members": [99], "main": 99, "category": "사회", "type": "useful"},
    {"rank": 3, "members": [2], "category": "사회", "type": "media"},
    {"rank": 4, "members": [3], "category": "사회", "type": "useful"},
    {"rank": 5, "members": [4], "category": "세계", "type": "weird"},
]}
picks = g.validate_picks(cfg, raw, cands)
print([(p["rank"], p["members"], p["main"], p["type"], p["category"]) for p in picks])
assert picks[0]["main"] == 1          # 방송사(SBS)를 대표로
assert picks[1]["type"] == "useful"   # 언론사 1곳 media → useful
assert len([p for p in picks if p["category"] == "사회"]) == 2
assert picks[-1]["type"] == "useful"
print("모든 검사 통과")
