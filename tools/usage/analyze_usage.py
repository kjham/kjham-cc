import json, os, sys, glob, collections, re
from datetime import datetime, timezone, timedelta

ROOT = os.path.join(os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude"), "projects")
KST = timezone(timedelta(hours=9))
import sys
# 사용법: python analyze_usage.py [시작일 YYYY-MM-DD] [끝일(미포함)]. 기본은 이번 달 1일부터 지금까지.
SINCE = datetime.fromisoformat(sys.argv[1] if len(sys.argv) > 1 else datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-01")).replace(tzinfo=KST)
UNTIL = datetime.fromisoformat(sys.argv[2]).replace(tzinfo=KST) if len(sys.argv) > 2 else datetime(2100, 1, 1, tzinfo=KST)
inwin = lambda d: SINCE <= d < UNTIL
START = SINCE

def proj_name(d):
    n = os.path.basename(d)
    # 폴더 이름은 작업 경로의 구분자를 '-' 로 바꾼 것이다. 앞쪽 공통 경로는 떼어 낸다.
    n = re.sub(r"^[A-Za-z]--", "-", n)
    n = re.sub(r"^-(Users|home)-[^-]+-", "~", n)
    n = re.sub(r"^-?workspace-", "", n)
    if "scratch-workspaces" in n: return "~claude-desktop-scratch"
    if "worktrees" in n: n = n.split("worktrees-")[0].rstrip("-") + "(wt)"
    return n

calls = {}          # dedupe key -> record
tool_calls = collections.Counter()
tool_result_chars = collections.Counter()
tool_result_n = collections.Counter()
tool_result_max = collections.Counter()
skill_calls = collections.Counter()
agent_types = collections.Counter()
compactions = collections.Counter()
sess_meta = {}
user_prompts = collections.Counter()
big_results = []

files = glob.glob(os.path.join(ROOT, "**", "*.jsonl"), recursive=True)
for fp in files:
    if os.path.getmtime(fp) < START.timestamp(): continue
    proj = proj_name(os.path.join(ROOT, os.path.relpath(fp, ROOT).split(os.sep)[0]))
    is_sub_file = os.sep + "subagents" + os.sep in fp
    id2tool = {}
    try:
        fh = open(fp, encoding="utf-8", errors="replace")
    except Exception:
        continue
    for line in fh:
        try: e = json.loads(line)
        except Exception: continue
        t = e.get("type")
        ts = e.get("timestamp")
        if t == "system" and e.get("subtype") == "compact_boundary":
            d = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(KST)
            if d >= START: compactions[d.strftime("%Y-%m")] += 1
        if e.get("isCompactSummary"):
            pass
        if t == "custom-title":
            sess_meta.setdefault(e.get("sessionId"), {})["title"] = e.get("customTitle")
        if t == "assistant":
            m = e.get("message", {})
            u = m.get("usage")
            if not ts: continue
            d = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(KST)
            if d < START: continue
            for c in m.get("content", []) or []:
                if c.get("type") == "tool_use":
                    nm = c.get("name")
                    id2tool[c.get("id")] = nm
                    if inwin(d):
                        tool_calls[nm] += 1
                        inp = c.get("input") or {}
                        if nm == "Skill": skill_calls[inp.get("skill")] += 1
                        if nm in ("Agent", "Task"): agent_types[inp.get("subagent_type") or "general"] += 1
            if not u or m.get("model") in (None, "<synthetic>"): continue
            key = (m.get("id"), e.get("requestId"))
            sid = e.get("sessionId")
            calls[key] = dict(
                d=d, proj=proj, sid=sid, model=m.get("model"),
                sub=bool(e.get("isSidechain")) or is_sub_file,
                inp=u.get("input_tokens", 0) or 0,
                cw=u.get("cache_creation_input_tokens", 0) or 0,
                cr=u.get("cache_read_input_tokens", 0) or 0,
                out=u.get("output_tokens", 0) or 0,
            )
        elif t == "user":
            if not ts: continue
            d = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(KST)
            if not inwin(d): continue
            m = e.get("message", {})
            cont = m.get("content")
            if isinstance(cont, str):
                if not e.get("isSidechain") and not e.get("isMeta"): user_prompts[proj] += 1
                continue
            for c in cont or []:
                if c.get("type") == "tool_result":
                    nm = id2tool.get(c.get("tool_use_id"), "?")
                    cc = c.get("content")
                    if isinstance(cc, list):
                        n = sum(len(x.get("text", "")) for x in cc if isinstance(x, dict))
                    else:
                        n = len(str(cc or ""))
                    tool_result_chars[nm] += n
                    tool_result_n[nm] += 1
                    tool_result_max[nm] = max(tool_result_max[nm], n)
                    if n > 40000: big_results.append((n, nm, proj))
                elif c.get("type") == "text" and not e.get("isSidechain") and not e.get("isMeta"):
                    if not c.get("text", "").startswith("<"): user_prompts[proj] += 1

rows = list(calls.values())
def tot(r): return r["inp"] + r["cw"] + r["cr"] + r["out"]
def ctx(r): return r["inp"] + r["cw"] + r["cr"]

out = {}
def agg(filt, keyf):
    a = collections.defaultdict(lambda: collections.Counter())
    for r in rows:
        if not filt(r): continue
        k = keyf(r)
        a[k]["calls"] += 1
        for f in ("inp", "cw", "cr", "out"): a[k][f] += r[f]
        a[k]["tot"] += tot(r)
    return a

nov = lambda r: inwin(r["d"])

def fmt(a, top=None, sortk="tot"):
    items = sorted(a.items(), key=lambda kv: -kv[1][sortk])
    if top: items = items[:top]
    lines = []
    for k, v in items:
        lines.append(f"{str(k):45s} calls={v['calls']:6d} in={v['inp']:>12,} cw={v['cw']:>13,} cr={v['cr']:>15,} out={v['out']:>11,} tot={v['tot']:>15,}")
    return "\n".join(lines)

print("== Month totals")
print(fmt(agg(lambda r: True, lambda r: r["d"].strftime("%Y-%m"))))
print("\n== window by day")
print(fmt(dict(sorted(agg(nov, lambda r: r["d"].strftime("%m-%d %a")).items())), sortk="calls") )
print("\n== window by week")
print(fmt(agg(lambda r: True, lambda r: "W" + r["d"].strftime("%V"))))
print("\n== window by model")
print(fmt(agg(nov, lambda r: r["model"])))
print("\n== window main vs subagent")
print(fmt(agg(nov, lambda r: "subagent" if r["sub"] else "main")))
print("\n== window by project")
print(fmt(agg(nov, lambda r: r["proj"]), top=20))
print("\n== window by hour (KST)")
print(fmt(dict(sorted(agg(nov, lambda r: r["d"].strftime("%H")).items())), sortk="calls"))

# context size distribution (main thread)
bins = [(0, 50e3), (50e3, 100e3), (100e3, 150e3), (150e3, 200e3), (200e3, 400e3), (400e3, 1e9)]
print("\n== window per-call context size distribution (main / sub)")
for label, f in (("main", lambda r: nov(r) and not r["sub"]), ("sub", lambda r: nov(r) and r["sub"])):
    rs = [r for r in rows if f(r)]
    T = sum(ctx(r) for r in rs) or 1
    for lo, hi in bins:
        sel = [r for r in rs if lo <= ctx(r) < hi]
        print(f"  {label:4s} {int(lo/1e3):>4d}k-{int(min(hi,1e9)/1e3):>7d}k calls={len(sel):6d} ({len(sel)/max(len(rs),1)*100:5.1f}%) ctx_tokens_share={sum(ctx(r) for r in sel)/T*100:5.1f}%")

# sessions
sess = collections.defaultdict(list)
for r in rows:
    if nov(r): sess[r["sid"]].append(r)
print("\n== window sessions:", len(sess))
srows = []
for sid, rs in sess.items():
    rs.sort(key=lambda r: r["d"])
    main = [r for r in rs if not r["sub"]]
    first = ctx(main[0]) if main else 0
    srows.append(dict(sid=sid, title=sess_meta.get(sid, {}).get("title", ""), proj=rs[0]["proj"], calls=len(rs),
        tot=sum(tot(r) for r in rs), cr=sum(r["cr"] for r in rs), cw=sum(r["cw"] for r in rs), out=sum(r["out"] for r in rs),
        maxctx=max((ctx(r) for r in main), default=0), first=first,
        sub=sum(tot(r) for r in rs if r["sub"]),
        hours=(rs[-1]["d"] - rs[0]["d"]).total_seconds() / 3600, model=collections.Counter(r["model"] for r in rs).most_common(1)[0][0]))
srows.sort(key=lambda s: -s["tot"])
T = sum(s["tot"] for s in srows)
acc = 0
for i, s in enumerate(srows[:25]):
    acc += s["tot"]
    print(f"  {i+1:2d} {s['title'][:28]:28s} {s['proj'][:22]:22s} calls={s['calls']:5d} tot={s['tot']/1e6:8.1f}M sub={s['sub']/1e6:6.1f}M maxctx={s['maxctx']/1e3:6.0f}k first={s['first']/1e3:5.0f}k span={s['hours']:6.1f}h {s['model']} cum={acc/T*100:4.1f}%")
firsts = sorted(s["first"] for s in srows if s["first"])
if firsts:
    print("  first-call context median=%.0fk p10=%.0fk p90=%.0fk" % (firsts[len(firsts)//2]/1e3, firsts[len(firsts)//10]/1e3, firsts[len(firsts)*9//10]/1e3))
calls_per = sorted(s["calls"] for s in srows)
print("  calls/session median=%d p90=%d max=%d" % (calls_per[len(calls_per)//2], calls_per[len(calls_per)*9//10], calls_per[-1]))
spans = sorted(s["hours"] for s in srows)
print("  span hours median=%.1f p90=%.1f; sessions >24h=%d" % (spans[len(spans)//2], spans[len(spans)*9//10], sum(1 for x in spans if x > 24)))

# idle gaps -> cache misses: gaps > 5min and >60min between consecutive main calls in a session, and cw on next call
gap5 = gap60 = 0; cw_after_gap = 0; cw_total = 0
for sid, rs in sess.items():
    main = [r for r in rs if not r["sub"]]
    for a, b in zip(main, main[1:]):
        g = (b["d"] - a["d"]).total_seconds()
        cw_total += b["cw"]
        if g > 3600:
            gap60 += 1; cw_after_gap += b["cw"]
        elif g > 300: gap5 += 1
print(f"\n== window idle gaps (main): 5-60min={gap5} >60min={gap60}; cache_write right after >60min gaps={cw_after_gap:,} of main cw {cw_total:,}")

print("\n== window compactions by month", dict(compactions))
print("\n== window tool calls"); [print(f"  {k:40s} {v}") for k, v in tool_calls.most_common(30)]
print("\n== window tool result chars (approx tokens = chars/3 for mixed ko/en)")
for k, v in tool_result_chars.most_common(25):
    print(f"  {k:40s} n={tool_result_n[k]:6d} chars={v:>12,} avg={v//max(tool_result_n[k],1):>7,} max={tool_result_max[k]:>9,}")
print("\n== big results >40k chars:", len(big_results))
for x in sorted(big_results, reverse=True)[:15]: print("  ", x)
print("\n== window skills"); [print(f"  {k}: {v}") for k, v in skill_calls.most_common(30)]
print("\n== window agent types"); [print(f"  {k}: {v}") for k, v in agent_types.most_common(30)]
print("\n== window user prompts by project"); [print(f"  {k}: {v}") for k, v in user_prompts.most_common(15)]
