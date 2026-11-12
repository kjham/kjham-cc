import json, os, glob, collections, re
from datetime import datetime, timezone, timedelta
ROOT = os.path.join(os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude"), "projects")
KST = timezone(timedelta(hours=9))
import sys
# 사용법: python turn_attribution.py [시작일 YYYY-MM-DD] [끝일(미포함)]. 기본은 이번 달 1일부터 지금까지.
SINCE = datetime.fromisoformat(sys.argv[1] if len(sys.argv) > 1 else datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-01")).replace(tzinfo=KST)
UNTIL = datetime.fromisoformat(sys.argv[2]).replace(tzinfo=KST) if len(sys.argv) > 2 else datetime(2100, 1, 1, tzinfo=KST)
inwin = lambda d: SINCE <= d < UNTIL
PAT = [("orchestrator-tick", r"^\[(Orchestrator|세션 감시)"), ("self-reminder", r"^\[자기 알림\]"),
       ("cve-watch", r"(CVE-2026|커널 CVE)"), ("task-notification", r"^<task-notification"),
       ("teammate-msg", r"^<(teammate|agent)-message|^\[from |SendMessage")]
kind_tok = collections.Counter(); kind_turns = collections.Counter(); kind_cost = collections.Counter()
seen = set(); total = 0; totcost = 0
first_lines = collections.Counter()
def cost(u):  # input-equivalent units: in 1, cw(1h) 2, cr 0.1, out 5
    return u.get("input_tokens",0) + 2*u.get("cache_creation_input_tokens",0) + 0.1*u.get("cache_read_input_tokens",0) + 5*u.get("output_tokens",0)
for fp in glob.glob(os.path.join(ROOT, "**", "*.jsonl"), recursive=True):
    if os.path.getmtime(fp) < SINCE.timestamp(): continue
    if os.sep + "subagents" + os.sep in fp: cur = "subagent-file"
    else: cur = "user"
    for line in open(fp, encoding="utf-8", errors="replace"):
        try: e = json.loads(line)
        except Exception: continue
        ts = e.get("timestamp")
        if not ts: continue
        d = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(KST)
        if not inwin(d): continue
        t = e.get("type")
        if t == "user" and not e.get("isSidechain") and "subagents" not in fp:
            c = e["message"].get("content")
            txt = c if isinstance(c, str) else " ".join(x.get("text","") for x in (c or []) if isinstance(x, dict) and x.get("type") == "text")
            if txt and not (isinstance(c, list) and any(isinstance(x, dict) and x.get("type") == "tool_result" for x in c)):
                s = txt.strip()
                s2 = re.sub(r"^(<system-reminder>.*?</system-reminder>\s*)+", "", s, flags=re.S).strip()
                k = "user"
                for name, p in PAT:
                    if re.search(p, s2[:300]): k = name; break
                if k == "user" and s2.startswith("<"): first_lines[s2[:40]] += 1; k = "other-injected:" + s2[1:20].split(">")[0].split(" ")[0]
                cur = k; kind_turns[k] += 1
        if t == "assistant":
            m = e.get("message", {}); u = m.get("usage")
            if not u or m.get("model") == "<synthetic>": continue
            key = (m.get("id"), e.get("requestId"))
            if key in seen: continue
            seen.add(key)
            tt = sum(u.get(f, 0) or 0 for f in ("input_tokens","cache_creation_input_tokens","cache_read_input_tokens","output_tokens"))
            kk = "subagent" if (e.get("isSidechain") or cur == "subagent-file") else cur
            kind_tok[kk] += tt; kind_cost[kk] += cost(u); total += tt; totcost += cost(u)
print("turns:", kind_turns.most_common())
for k, v in kind_tok.most_common():
    print(f"{k:35s} tok={v/1e6:9.1f}M ({v/total*100:4.1f}%)  cost-units={kind_cost[k]/1e6:8.1f}M ({kind_cost[k]/totcost*100:4.1f}%)")
print("total cost units", totcost/1e6)
print(first_lines.most_common(10))
