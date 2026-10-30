#!/usr/bin/env python3
"""오늘의 시사 — 매일 아침 뉴스 선정 + 학습지 생성

GitHub Actions에서 실행됩니다.
  python scripts/generate.py            # 오늘 것 만들기 (주말·방학이면 건너뜀)
  python scripts/generate.py --force    # 주말·방학이어도 만들기
  python scripts/generate.py --hide 2026-10-30     # 그날 뉴스 숨기기
  python scripts/generate.py --unhide 2026-10-30   # 다시 보이기
  python scripts/generate.py --mock     # 인터넷 없이 테스트 자료로 실행

필요한 비밀값(환경변수): GEMINI_API_KEY, YOUTUBE_API_KEY(없으면 영상 없이 진행)
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ARCHIVE = DATA / "archive"
PROMPTS = ROOT / "prompts"
FIXTURES = ROOT / "tests" / "fixtures"
KST = dt.timezone(dt.timedelta(hours=9))
UA = "Mozilla/5.0 (compatible; TodayNewsForKids/1.0; +https://github.com)"

MOCK = False
RUN: dict = {"feeds": [], "notes": []}  # 실행 요약 (data/last_run.json 으로 저장)


def log(*a):
    print("[오늘의시사]", *a, flush=True)


# ─────────────────────────── 설정·날짜 ───────────────────────────

def load_config() -> dict:
    return json.loads((ROOT / "config.json").read_text(encoding="utf-8"))


def today_kst() -> dt.date:
    return dt.datetime.now(KST).date()


def should_skip(cfg: dict, d: dt.date) -> str | None:
    if cfg.get("weekdays_only", True) and d.weekday() >= 5:
        return "주말"
    if d.isoformat() in cfg.get("skip_dates", []):
        return "쉬는 날(skip_dates)"
    for r in cfg.get("pause_ranges", []):
        if r["from"] <= d.isoformat() <= r["to"]:
            return f"쉬는 기간({r.get('memo', '')})"
    return None


# ─────────────────────────── 네트워크 ───────────────────────────

def http_get(url: str, timeout: int = 20) -> str:
    import requests
    r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "ko-KR,ko"}, timeout=timeout)
    r.raise_for_status()
    if not r.encoding or r.encoding.lower() == "iso-8859-1":
        r.encoding = r.apparent_encoding
    return r.text


def clean_text(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def norm_title(t: str) -> str:
    t = re.sub(r"\[[^\]]*\]|\([^)]*\)|<[^>]*>", "", t)
    t = re.sub(r"\s*[-|]\s*(YTN|KBS|MBC|SBS|JTBC|연합뉴스TV|연합뉴스|KBS 뉴스|MBC 뉴스).*$", "", t)
    return re.sub(r"[^가-힣a-zA-Z0-9]", "", t).lower()


# ─────────────────────────── 1. RSS 후보 수집 ───────────────────────────

def fetch_candidates(cfg: dict) -> list[dict]:
    import feedparser
    now = dt.datetime.now(dt.timezone.utc)
    cutoff = now - dt.timedelta(hours=cfg.get("hours_back", 30))
    items, seen = [], set()
    for i, f in enumerate(cfg["feeds"]):
        try:
            if MOCK:
                raw = (FIXTURES / f"feed{i}.xml").read_text(encoding="utf-8") if (FIXTURES / f"feed{i}.xml").exists() else ""
            else:
                raw = http_get(f["url"])
            parsed = feedparser.parse(raw)
        except Exception as e:  # 한 피드가 막혀도 나머지로 진행
            log(f"피드 실패: {f['source']} ({e})")
            RUN["feeds"].append({"source": f["source"], "via": f.get("via", "direct"), "count": 0,
                                 "error": str(e)[:120]})
            continue
        count = 0
        for e in parsed.entries:
            title = clean_text(e.get("title", ""))
            if f.get("via") == "google":
                title = re.sub(r"\s+-\s+[^-]+$", "", title)  # "제목 - 언론사" 꼬리 제거
            link = e.get("link", "")
            if not title or not link:
                continue
            ts = e.get("published_parsed") or e.get("updated_parsed")
            if ts and not MOCK:
                pub = dt.datetime(*ts[:6], tzinfo=dt.timezone.utc)
                if pub < cutoff:
                    continue
            key = (f["source"], norm_title(title))
            if key in seen:
                continue
            seen.add(key)
            desc = clean_text(e.get("summary", "") or e.get("description", ""))
            if f.get("via") == "google":
                desc = ""  # 구글 뉴스 요약은 제목 반복이라 버림
            items.append({
                "source": f["source"], "title": title, "desc": desc[:220],
                "link": link, "via": f.get("via", "direct"),
            })
            count += 1
        log(f"피드 {f['source']}{'(구글)' if f.get('via') == 'google' else ''}: {count}건")
        RUN["feeds"].append({"source": f["source"], "via": f.get("via", "direct"), "count": count,
                             "raw_entries": len(parsed.entries)})
    return items


def apply_banned(cfg: dict, items: list[dict]) -> list[dict]:
    banned = cfg.get("banned_words", [])
    kept = [it for it in items if not any(b in it["title"] or b in it["desc"] for b in banned)]
    log(f"금지어 필터: {len(items)} → {len(kept)}건")
    # 언론사별로 골고루 섞기 (한 언론사가 후보 칸을 다 차지하지 않도록)
    by_src: dict[str, list] = {}
    for it in kept:
        by_src.setdefault(it["source"], []).append(it)
    limit = cfg.get("max_candidates", 90)
    out, i = [], 0
    while len(out) < limit and any(i < len(v) for v in by_src.values()):
        for v in by_src.values():
            if i < len(v) and len(out) < limit:
                out.append(v[i])
        i += 1
    RUN["candidates_by_source"] = {k: sum(1 for x in out if x["source"] == k) for k in by_src}
    log("후보 언론사 분포:", RUN["candidates_by_source"])
    for n, it in enumerate(out):
        it["id"] = n
    return out


# ─────────────────────────── Gemini ───────────────────────────

def gemini(cfg: dict, prompt: str, mock_name: str, temperature: float = 0.4) -> dict:
    if MOCK:
        return json.loads((FIXTURES / mock_name).read_text(encoding="utf-8"))
    import requests
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise SystemExit("GEMINI_API_KEY 비밀값이 없습니다. 설치 안내 2단계를 확인하세요.")
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": temperature, "responseMimeType": "application/json"},
    }
    last = None
    for model in cfg["gemini_models"]:
        for attempt in range(3):
            try:
                r = requests.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                    headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                    json=body, timeout=300,
                )
                if r.status_code in (429, 500, 502, 503):
                    last = f"{model} {r.status_code}"
                    time.sleep(10 * (attempt + 1))
                    continue
                if r.status_code == 404:
                    last = f"{model} 모델 없음"
                    break
                r.raise_for_status()
                text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
                text = re.sub(r"^```(json)?|```$", "", text.strip()).strip()
                log(f"Gemini 응답 받음 ({model})")
                RUN["model"] = model
                return json.loads(text)
            except (json.JSONDecodeError, KeyError, IndexError) as e:
                last = f"{model} 응답 형식 오류 {e}"
                time.sleep(3)
            except requests.exceptions.RequestException as e:  # 시간 초과·연결 끊김 → 다시 시도
                last = f"{model} 연결 문제 {str(e)[:80]}"
                log(f"Gemini 연결 문제, 다시 시도 ({attempt + 1}/3): {model}")
                time.sleep(10)
    raise RuntimeError(f"Gemini 호출 실패: {last}")


# ─────────────────────────── 2. 선정 ───────────────────────────

def recent_topics(n: int = 7) -> list[str]:
    idx = DATA / "index.json"
    if not idx.exists():
        return []
    try:
        return [e.get("topic", "") for e in json.loads(idx.read_text(encoding="utf-8"))[:n]]
    except Exception:
        return []


def build_select_prompt(cfg: dict, cands: list[dict]) -> str:
    tpl = (PROMPTS / "select.md").read_text(encoding="utf-8")
    rule = ("- **지금은 선거 기간이다. 정책 뉴스도 모두 제외한다.**"
            if cfg.get("election_mode") else "")
    tpl = tpl.replace("{{ELECTION_RULE}}", rule)
    lines = [f'{c["id"]}. [{c["source"]}] {c["title"]}' + (f' — {c["desc"]}' if c["desc"] else "")
             for c in cands]
    recent = ", ".join(t for t in recent_topics() if t) or "없음"
    return f"{tpl}\n\n[최근 1순위 주제]\n{recent}\n\n[후보 기사 목록]\n" + "\n".join(lines)


def validate_picks(cfg: dict, raw: dict, cands: list[dict]) -> list[dict]:
    by_id = {c["id"]: c for c in cands}
    picks, used, cat_count = [], set(), {}
    for p in sorted(raw.get("picks", []), key=lambda x: x.get("rank", 99)):
        members = [m for m in p.get("members", []) if isinstance(m, int) and m in by_id and m not in used]
        if not members:
            continue
        main = p.get("main") if p.get("main") in members else members[0]
        # 방송사 기사를 대표로
        bc = [m for m in members if by_id[m]["source"] in cfg["broadcasters"]]
        if by_id[main]["source"] not in cfg["broadcasters"] and bc:
            main = bc[0]
        cat = p.get("category", "기타")
        if cat_count.get(cat, 0) >= 2:
            continue
        typ = p.get("type", "useful")
        sources = {by_id[m]["source"] for m in members}
        if typ == "media" and len(sources) < 2:
            typ = "useful"
        if typ not in ("useful", "debate", "media"):
            typ = "useful"
        # 다시 한번 금지어
        if any(b in by_id[main]["title"] for b in cfg["banned_words"]):
            continue
        cat_count[cat] = cat_count.get(cat, 0) + 1
        used.update(members)
        picks.append({
            "members": members, "main": main, "category": cat, "type": typ,
            "score": p.get("score"), "topic": str(p.get("topic", ""))[:20],
            "reason": str(p.get("reason", ""))[:120],
        })
        if len(picks) == 5:
            break
    for i, p in enumerate(picks):
        p["rank"] = i + 1
    return picks


# ─────────────────────────── 3. 본문 (1순위만) ───────────────────────────

def fetch_body(url: str) -> str:
    if MOCK:
        f = FIXTURES / "body.txt"
        return f.read_text(encoding="utf-8") if f.exists() else ""
    from bs4 import BeautifulSoup
    try:
        soup = BeautifulSoup(http_get(url), "html.parser")
    except Exception as e:
        log(f"본문 실패: {e}")
        return ""
    for t in soup(["script", "style", "noscript", "iframe", "header", "footer", "nav", "aside", "form"]):
        t.decompose()
    best = ""
    for sel in ["article", "#articleBodyContents", "#newsct_article", ".article_body", "#CmAdContent",
                ".news_text", "#cont_newstext", ".text_area", ".article-body", "#article-view-content-div",
                ".story-news", "#articleWrap", ".news_body"]:
        node = soup.select_one(sel)
        if node:
            txt = clean_text(node.get_text(" "))
            if len(txt) > len(best):
                best = txt
    if len(best) < 300:
        paras = [clean_text(p.get_text(" ")) for p in soup.find_all("p")]
        best = " ".join(p for p in paras if len(p) > 40)
    return best[:3500]


def gather_body(pick: dict, by_id: dict) -> str:
    order = [pick["main"]] + [m for m in pick["members"] if m != pick["main"]]
    for m in order:
        c = by_id[m]
        if c["via"] == "google":  # 구글 뉴스 링크는 본문을 바로 못 읽음
            continue
        body = fetch_body(c["link"])
        if len(body) > 200:
            log(f"본문 확보: {c['source']} {len(body)}자")
            return body
    log("본문 없이 RSS 요약만으로 진행")
    return ""


# ─────────────────────────── 4. 유튜브 영상 ───────────────────────────

_channel_cache: dict = {}


def yt_get(path: str, params: dict) -> dict:
    import requests
    params = dict(params, key=os.environ["YOUTUBE_API_KEY"])
    r = requests.get(f"https://www.googleapis.com/youtube/v3/{path}", params=params, timeout=20)
    r.raise_for_status()
    return r.json()


def resolve_channels(cfg: dict) -> dict:
    """handle → channelId. 실패한 채널은 제목으로만 확인."""
    if _channel_cache:
        return _channel_cache
    for ch in cfg["youtube_channels"]:
        try:
            res = yt_get("channels", {"part": "id,snippet", "forHandle": ch["handle"]})
            items = res.get("items", [])
            if items:
                _channel_cache[items[0]["id"]] = ch
                log(f"채널 확인: {ch['name']} → {items[0]['snippet']['title']}")
            else:
                log(f"채널 확인 실패: {ch['name']} ({ch['handle']}) — config.json의 handle을 확인하세요")
        except Exception as e:
            log(f"채널 확인 오류: {ch['name']} {e}")
    return _channel_cache


def find_videos(cfg: dict, pick: dict, by_id: dict) -> list[dict]:
    if MOCK:
        f = FIXTURES / "videos.json"
        return json.loads(f.read_text(encoding="utf-8")) if f.exists() else []
    if not os.environ.get("YOUTUBE_API_KEY"):
        log("YOUTUBE_API_KEY 없음 → 영상 없이 진행")
        return []
    ids = resolve_channels(cfg)
    title_map = {t: ch for ch in cfg["youtube_channels"] for t in ch["titles"]}
    after = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=40)).strftime("%Y-%m-%dT%H:%M:%SZ")
    queries = []
    for m in [pick["main"]] + pick["members"]:
        q = re.sub(r"\[[^\]]*\]|\([^)]*\)|[\"'“”‘’…]", " ", by_id[m]["title"])
        q = re.sub(r"\s+", " ", q).strip()
        if q and q not in queries:
            queries.append(q)
    found, seen = [], set()
    for q in queries[:2]:  # 검색은 최대 2번 (하루 무료 한도 안에서 넉넉함)
        try:
            res = yt_get("search", {"part": "snippet", "q": q, "type": "video", "maxResults": 25,
                                    "publishedAfter": after, "regionCode": "KR", "relevanceLanguage": "ko",
                                    "videoEmbeddable": "true", "safeSearch": "strict"})
        except Exception as e:
            log(f"유튜브 검색 오류: {e}")
            break
        for it in res.get("items", []):
            sn, vid = it["snippet"], it["id"].get("videoId")
            ch = ids.get(sn["channelId"]) or title_map.get(sn["channelTitle"])
            if not vid or not ch or vid in seen:
                continue
            seen.add(vid)
            found.append({"id": vid, "title": html.unescape(sn["title"]), "channel": ch["name"],
                          "kind": ch["kind"]})
    found.sort(key=lambda v: 0 if v["kind"] == "news" else 1)
    log(f"공식 채널 영상 후보 {len(found)}개")
    return found[:8]


# ─────────────────────────── 5. 학습지 ───────────────────────────

def build_worksheet_prompt(pick: dict, others: list[dict], by_id: dict, body: str, videos: list[dict],
                           d: dt.date) -> str:
    tpl = (PROMPTS / "worksheet.md").read_text(encoding="utf-8")
    main = by_id[pick["main"]]
    parts = [tpl, f"\n\n오늘 날짜: {d.year}년 {d.month}월 {d.day}일 (기사는 어제~오늘 보도)",
             "\n[1순위 기사 자료]",
             f"유형(type): {pick['type']}", f"분야: {pick['category']}", f"주제: {pick['topic']}",
             f"대표 제목: {main['title']}"]
    for m in pick["members"]:
        c = by_id[m]
        if c["desc"]:
            parts.append(f"- [{c['source']}] 요약: {c['desc']}")
    if body:
        parts.append(f"본문(참고용, 그대로 옮기지 말 것):\n{body}")
    if pick["type"] == "media":
        parts.append("\n[언론사별 제목]")
        for m in pick["members"]:
            parts.append(f"- {by_id[m]['source']}: {by_id[m]['title']}")
    parts.append("\n[2~5순위 기사 자료]")
    for o in others:
        c = by_id[o["main"]]
        parts.append(f"{o['rank']}순위: [{c['source']}] {c['title']}" + (f" — {c['desc']}" if c["desc"] else ""))
    parts.append("\n[영상 후보]")
    if videos:
        for i, v in enumerate(videos):
            parts.append(f"{i}. ({v['channel']}) {v['title']}")
        parts.append('1순위 기사와 같은 사건을 다룬 영상의 번호를 "video_index"에 넣어라. '
                     '정규 보도를 우선하고, 같은 사건이 아니면 -1. 출력 JSON 맨 바깥에 "video_index"를 추가한다.')
    else:
        parts.append('영상 후보 없음. "video_index": -1 을 출력 JSON 맨 바깥에 추가한다.')
    return "\n".join(parts)


NUM_RE = re.compile(r"\d[\d,.]*")
# 글자 수 상한 (띄어쓰기 포함). 지침(worksheet.md)의 목표보다 5자쯤 여유
LIMITS = {"word": 15, "summary": 35, "five_w": 18, "sentence": 30, "question": 30, "reason": 35}


def all_text(obj) -> str:
    if isinstance(obj, str):
        return obj
    if isinstance(obj, dict):
        return " ".join(all_text(v) for v in obj.values())
    if isinstance(obj, list):
        return " ".join(all_text(v) for v in obj)
    return ""


def check_worksheet(cfg: dict, ws: dict, pick: dict, source_text: str) -> list[str]:
    """문제 목록을 돌려줌. 빈 목록이면 통과."""
    problems = []
    m = ws.get("main") or {}

    def too_long(label: str, s, limit: int):
        if isinstance(s, str) and len(s) > limit:
            problems.append(f"{label}이(가) 너무 김 ({len(s)}자, {limit}자 이내로): {s[:20]}…")

    # 분량 (5·6학년 아침 10~15분 기준) — 지침보다 조금 여유 있게 검사
    if len(m.get("words", [])) != 2:
        problems.append("낱말은 정확히 2개여야 함")
    for w in m.get("words", []):
        if len(w.get("wrong", [])) != 2:
            problems.append(f"낱말 '{w.get('word')}'의 오답 뜻은 2개여야 함")
        for s in [w.get("meaning", "")] + list(w.get("wrong", [])):
            too_long("낱말 뜻 보기", s, LIMITS["word"])
    summ = m.get("summary", [])
    if len(summ) != 3:
        problems.append("요약은 정확히 3문장이어야 함")
    for s in summ:
        too_long("요약 문장", s, LIMITS["summary"])
    fw = m.get("five_w", {})
    for k in ("who", "what", "why"):
        if not fw.get(k):
            problems.append(f"육하원칙 {k} 빈칸 (없으면 '기사에 없음')")
    for k, v in fw.items():
        too_long(f"육하원칙 {k}", v, LIMITS["five_w"])
    fo = m.get("facts_opinions", [])
    if len(fo) != 4 or sorted(x.get("answer") for x in fo) != ["사실", "사실", "의견", "의견"]:
        problems.append("사실 2개·의견 2개, 총 4문장이어야 함")
    for x in fo:
        too_long("사실·의견 문장", x.get("sentence", ""), LIMITS["sentence"])
    act = m.get("activity", {})
    need = {"useful": ["impact_question", "wonder_question"],
            "debate": ["issue", "side_a", "side_b", "choose_question", "other_side_question"],
            "media": ["feeling_choices", "why_question", "rewrite_question"]}[pick["type"]]
    for k in need:
        if not act.get(k):
            problems.append(f"핵심 활동 '{k}' 없음")
    for k in ("issue", "impact_question", "wonder_question", "choose_question", "other_side_question",
              "why_question", "rewrite_question"):
        too_long(f"발문 {k}", act.get(k, ""), LIMITS["question"])
    for c in act.get("feeling_choices", []):
        too_long("느낌 보기", c, LIMITS["word"])
    if pick["type"] == "debate":
        for side in ("side_a", "side_b"):
            reasons = act.get(side, {}).get("reasons", [])
            if len(reasons) != 1:
                problems.append(f"{side} 이유는 1개여야 함")
            for r in reasons:
                too_long(f"{side} 이유", r, LIMITS["reason"])
    too_long("도전 문항", m.get("challenge", ""), LIMITS["question"] + 15)
    # 중립 검사: 제목·요약·발문에 한쪽으로 기운 표현이 있으면 안 됨 (찬반 이유·의견 문장은 제외)
    neutral_text = all_text([m.get("title", ""), m.get("summary", []), act.get("issue", ""),
                             {k: v for k, v in act.items() if k.endswith("_question")},
                             [[o.get("title", ""), o.get("brief_summary", []), o.get("question", "")]
                              for o in ws.get("others", [])]])
    loaded = [w for w in cfg.get("loaded_words", []) if w in neutral_text]
    if loaded:
        problems.append(f"한쪽으로 기운 표현: {', '.join(loaded)} (제목·요약·발문은 중립적으로)")
    text = all_text(ws)
    hit = [b for b in cfg["banned_words"] if len(b) >= 2 and b in text and b not in ("속보", "단독", "포토", "날씨", "광고")]
    if hit:
        problems.append(f"금지어 포함: {', '.join(hit)}")
    # 지어낸 숫자 검사: 요약·육하원칙에 나온 숫자는 자료에 있어야 함
    src_nums = {n.replace(",", "") for n in NUM_RE.findall(source_text)}
    for n in NUM_RE.findall(all_text([m.get("summary", []), fw])):
        n2 = n.replace(",", "").rstrip(".")
        if len(n2) >= 2 and n2 not in src_nums:
            problems.append(f"자료에 없는 숫자 '{n}' (지어낸 내용일 수 있음)")
    return problems


def make_worksheet(cfg, picks, by_id, body, videos, d) -> dict:
    pick, others = picks[0], picks[1:]
    prompt = build_worksheet_prompt(pick, others, by_id, body, videos, d)
    source_text = prompt  # 자료 전체를 숫자 검사 기준으로
    ws = gemini(cfg, prompt, "worksheet.json", temperature=0.5)
    problems = check_worksheet(cfg, ws, pick, source_text)
    if problems and not MOCK:
        log("학습지 검사 문제 → 한 번 다시 요청:", problems)
        fix = prompt + "\n\n[이전 출력의 문제점 — 모두 고쳐서 다시 출력]\n- " + "\n- ".join(problems)
        ws = gemini(cfg, fix, "worksheet.json", temperature=0.3)
        problems = check_worksheet(cfg, ws, pick, source_text)
    ws["_problems"] = problems
    return ws


# ─────────────────────────── 6. 저장 ───────────────────────────

def assemble(cfg, d: dt.date, picks, by_id, ws, videos) -> dict:
    pick = picks[0]
    vi = ws.get("video_index", -1)
    video = videos[vi] if isinstance(vi, int) and 0 <= vi < len(videos) else None
    main = ws.get("main", {})
    if pick["type"] == "media":
        main["headlines"] = [{"source": by_id[m]["source"], "title": by_id[m]["title"],
                              "link": by_id[m]["link"]} for m in pick["members"]]
    others_ai = {o.get("rank"): o for o in ws.get("others", [])}
    others = []
    for p in picks[1:]:
        c = by_id[p["main"]]
        o = others_ai.get(p["rank"], {})
        others.append({
            "rank": p["rank"], "type": p["type"], "category": p["category"], "topic": p["topic"],
            "title": o.get("title") or c["title"], "brief_summary": o.get("brief_summary", []),
            "question": o.get("question", ""), "source": c["source"], "link": c["link"],
            "reason": p["reason"],
        })
    c = by_id[pick["main"]]
    return {
        "date": d.isoformat(),
        "generated_at": dt.datetime.now(KST).isoformat(timespec="minutes"),
        "hidden": False,
        "sample": MOCK,
        "needs_review": bool(ws.get("_problems")),
        "review_notes": ws.get("_problems", []),
        "main": {
            **main,
            "rank": 1, "type": pick["type"], "category": pick["category"], "topic": pick["topic"],
            "reason": pick["reason"], "source": c["source"], "link": c["link"],
            "original_title": c["title"],
            "related": [{"source": by_id[m]["source"], "link": by_id[m]["link"]}
                        for m in pick["members"] if m != pick["main"]][:4],
            "video": video,
        },
        "others": others,
    }


def save(day: dict):
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(day, ensure_ascii=False, indent=1)
    (ARCHIVE / f"{day['date']}.json").write_text(txt, encoding="utf-8")
    (DATA / "today.json").write_text(txt, encoding="utf-8")
    idx_path = DATA / "index.json"
    idx = json.loads(idx_path.read_text(encoding="utf-8")) if idx_path.exists() else []
    idx = [e for e in idx if e["date"] != day["date"]]
    idx.insert(0, {"date": day["date"], "title": day["main"].get("title", ""), "topic": day["main"]["topic"],
                   "type": day["main"]["type"], "category": day["main"]["category"], "hidden": day["hidden"]})
    idx_path.write_text(json.dumps(idx[:120], ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"저장 완료: {day['date']} — {day['main'].get('title')}")


def set_hidden(date: str, hidden: bool):
    p = ARCHIVE / f"{date}.json"
    if not p.exists():
        raise SystemExit(f"{date} 자료가 없습니다.")
    day = json.loads(p.read_text(encoding="utf-8"))
    day["hidden"] = hidden
    p.write_text(json.dumps(day, ensure_ascii=False, indent=1), encoding="utf-8")
    today = DATA / "today.json"
    if today.exists() and json.loads(today.read_text(encoding="utf-8")).get("date") == date:
        today.write_text(json.dumps(day, ensure_ascii=False, indent=1), encoding="utf-8")
    idx_path = DATA / "index.json"
    if idx_path.exists():
        idx = json.loads(idx_path.read_text(encoding="utf-8"))
        for e in idx:
            if e["date"] == date:
                e["hidden"] = hidden
        idx_path.write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"{date} {'숨김' if hidden else '다시 보이기'} 완료")


# ─────────────────────────── 실행 ───────────────────────────

def write_run_summary(status: str):
    RUN["status"] = status
    RUN["finished_at"] = dt.datetime.now(KST).isoformat(timespec="minutes")
    try:
        DATA.mkdir(parents=True, exist_ok=True)
        (DATA / "last_run.json").write_text(json.dumps(RUN, ensure_ascii=False, indent=1), encoding="utf-8")
    except Exception:
        pass
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        lines = [f"## 오늘의 시사 실행 결과: {status}", "", "| 피드 | 기사 수 | 비고 |", "|---|---|---|"]
        for f in RUN["feeds"]:
            lines.append(f"| {f['source']}{' (구글)' if f['via'] == 'google' else ''} | {f['count']} | {f.get('error', '')} |")
        for n in RUN.get("notes", []):
            lines.append(f"\n- {n}")
        with open(path, "a", encoding="utf-8") as fp:
            fp.write("\n".join(lines) + "\n")


def main():
    if "--hide" in sys.argv or "--unhide" in sys.argv:
        return run()
    try:
        run()
        write_run_summary(RUN.get("status_override", "성공"))
    except BaseException as e:
        RUN["notes"].append(f"오류: {e}")
        write_run_summary("실패")
        raise


def run():
    global MOCK
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--hide")
    ap.add_argument("--unhide")
    ap.add_argument("--date")
    a = ap.parse_args()
    MOCK = a.mock
    if a.hide:
        return set_hidden(a.hide, True)
    if a.unhide:
        return set_hidden(a.unhide, False)

    cfg = load_config()
    d = dt.date.fromisoformat(a.date) if a.date else today_kst()
    reason = should_skip(cfg, d)
    if reason and not a.force:
        log(f"{d} 은(는) {reason}이라 건너뜁니다.")
        RUN["status_override"] = f"건너뜀({reason})"
        return

    cands = apply_banned(cfg, fetch_candidates(cfg))
    if len(cands) < 5:
        raise SystemExit("후보 기사가 너무 적습니다. 피드 주소를 확인하세요. (어제 학습지가 그대로 보입니다)")
    by_id = {c["id"]: c for c in cands}

    picks = validate_picks(cfg, gemini(cfg, build_select_prompt(cfg, cands), "select.json"), cands)
    if not picks:
        raise SystemExit("선정 결과가 비었습니다. (어제 학습지가 그대로 보입니다)")
    for p in picks:
        log(f"{p['rank']}순위 [{p['type']}/{p['category']}] {by_id[p['main']]['title']}")
    RUN["picks"] = [{"rank": p["rank"], "type": p["type"], "source": by_id[p["main"]]["source"],
                     "title": by_id[p["main"]]["title"]} for p in picks]

    body = gather_body(picks[0], by_id)
    videos = find_videos(cfg, picks[0], by_id)
    RUN["body_chars"], RUN["video_candidates"] = len(body), len(videos)
    ws = make_worksheet(cfg, picks, by_id, body, videos, d)
    RUN["problems"] = ws["_problems"]
    if ws["_problems"]:
        log("검사에서 남은 문제(교사 검토 표시로 공개):", ws["_problems"])
    save(assemble(cfg, d, picks, by_id, ws, videos))


if __name__ == "__main__":
    main()
