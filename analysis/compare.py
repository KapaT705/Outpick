import json, sys, collections
S = sys.argv[1]
HEROES = {74:"Invoker",39:"Queen of Pain",86:"Rubick",106:"Ember Spirit",25:"Lina",7:"Earthshaker"}
MARKS = [10,15,20,25]

def cum(arr, m): return sum(arr[:m]) if arr else None
def deaths_by(evts, m): return sum(1 for e in evts if e["time"] <= m*60)

def collect(matches, pid=None):
    out = collections.defaultdict(list)
    for m in matches:
        p = m["players"][0]
        st = p.get("stats") or {}
        if not st.get("lastHitsPerMinute"): continue
        h = p["heroId"]
        if h not in HEROES: continue
        dur = m["durationSeconds"]/60
        row = {"win": p["isVictory"], "dur": dur, "deaths": p["deaths"], "kills": p["kills"], "gpm": p["goldPerMinute"]}
        for k in MARKS:
            if dur >= k:
                row[f"lh{k}"] = cum(st["lastHitsPerMinute"], k)
                row[f"d{k}"] = deaths_by(st["deathEvents"], k)
                if st.get("networthPerMinute"): row[f"nw{k}"] = st["networthPerMinute"][k-1] if len(st["networthPerMinute"])>=k else None
        row["dn10"] = cum(st.get("deniesPerMinute"), 10) if st.get("deniesPerMinute") else None
        row["runes"] = st.get("runes")
        row["items"] = st.get("itemPurchases")
        row["deathTimes"] = [e["time"]/60 for e in st["deathEvents"]]
        out[h].append(row)
    return out

def avg(rows, key):
    v = [r[key] for r in rows if r.get(key) is not None]
    return (sum(v)/len(v), len(v)) if v else (None, 0)

own = json.load(open(f"{S}/own_stats.json"))["data"]["player"]["matches"]
own_rows = collect(own)
top = []
for i in (1,2,3):
    d = json.load(open(f"{S}/top_{i}.json"))["data"]
    for v in d.values():
        top.extend(v["matches"])
top_rows = collect(top)
bench = json.load(open(f"{S}/bench_time.json"))["data"]["heroStats"]["stats"]
B = {(b["heroId"], b["time"]): b for b in bench}

def fmt(x, nd=1): return "-" if x is None else (f"{x:.{nd}f}" if isinstance(x,float) else str(x))

print("=== LAST HITS at minute (cumulative)  |  you (n games) / Divine-Immortal avg / top-mid avg ===")
for h,name in HEROES.items():
    o, t = own_rows.get(h,[]), top_rows.get(h,[])
    if not o: continue
    parts=[]
    for k in MARKS:
        oa,on = avg(o,f"lh{k}"); ta,tn = avg(t,f"lh{k}"); b = B.get((h,k),{}).get("cs")
        parts.append(f"@{k}: {fmt(oa,0)} / {fmt(b,0)} / {fmt(ta,0)}")
    print(f"{name:14s} (you n={len(o)}, top n={len(t)})  " + "   ".join(parts))

print("\n=== DEATHS by minute (cumulative)  |  you / Divine-Immortal / top ===")
for h,name in HEROES.items():
    o, t = own_rows.get(h,[]), top_rows.get(h,[])
    if not o: continue
    parts=[]
    for k in MARKS:
        oa,_ = avg(o,f"d{k}"); ta,_ = avg(t,f"d{k}"); b = B.get((h,k),{}).get("deaths")
        parts.append(f"@{k}: {fmt(oa)} / {fmt(b)} / {fmt(ta)}")
    print(f"{name:14s} " + "   ".join(parts))

print("\n=== PER GAME: deaths, kills, GPM, avg duration  |  you / top ===")
for h,name in HEROES.items():
    o, t = own_rows.get(h,[]), top_rows.get(h,[])
    if not o: continue
    print(f"{name:14s} deaths {fmt(avg(o,'deaths')[0])} / {fmt(avg(t,'deaths')[0])}   kills {fmt(avg(o,'kills')[0])} / {fmt(avg(t,'kills')[0])}   gpm {fmt(avg(o,'gpm')[0],0)} / {fmt(avg(t,'gpm')[0],0)}   dur {fmt(avg(o,'dur')[0],0)} / {fmt(avg(t,'dur')[0],0)}   WR {sum(r['win'] for r in o)/len(o)*100:.0f}% / {sum(r['win'] for r in t)/len(t)*100:.0f}%")

# deaths per 10 minutes normalized
def dp10(rows):
    d = sum(r["deaths"] for r in rows); m = sum(r["dur"] for r in rows)
    return d/m*10 if m else None
allo = [r for rs in own_rows.values() for r in rs]; allt = [r for rs in top_rows.values() for r in rs]
print(f"\nDeaths per 10 min (all 6 heroes): you {dp10(allo):.2f} / top {dp10(allt):.2f}")
print(f"Kills per 10 min: you {sum(r['kills'] for r in allo)/sum(r['dur'] for r in allo)*10:.2f} / top {sum(r['kills'] for r in allt)/sum(r['dur'] for r in allt)*10:.2f}")

# early deaths share
def early(rows, lim): 
    tot = sum(len(r["deathTimes"]) for r in rows); e = sum(1 for r in rows for t in r["deathTimes"] if t<=lim); return e/tot*100 if tot else 0
print(f"Share of deaths before 10 min: you {early(allo,10):.0f}% / top {early(allt,10):.0f}%;  before 15 min: you {early(allo,15):.0f}% / top {early(allt,15):.0f}%")

# wins vs losses deaths
w = [r for r in allo if r["win"]]; l = [r for r in allo if not r["win"]]
print(f"\nYour deaths/game in wins: {avg(w,'deaths')[0]:.1f}  in losses: {avg(l,'deaths')[0]:.1f};  LH@10 in wins {avg(w,'lh10')[0]:.0f} vs losses {avg(l,'lh10')[0]:.0f};  deaths by 10 in wins {avg(w,'d10')[0]:.2f} vs losses {avg(l,'d10')[0]:.2f}")

# death-time histogram
hist = collections.Counter(int(t//5)*5 for r in allo for t in r["deathTimes"])
histt = collections.Counter(int(t//5)*5 for r in allt for t in r["deathTimes"])
no, nt = len(allo), len(allt)
print("\nDeaths per game by 5-min window (you / top):")
for b in range(0,60,5):
    print(f"  {b:2d}-{b+5:2d} min: {hist[b]/no:.2f} / {histt[b]/nt:.2f}")

# runes
print("\nRunes picked per game (you):")
rc = collections.Counter(); n=0
for r in allo:
    if r["runes"] is None: continue
    n+=1
    for ru in r["runes"]:
        if ru.get("action") in (None, "PICKUP", 0): rc[ru["rune"]] += 1
for k,v in rc.most_common(): print(f"  {k}: {v/n:.2f}")
# items
json.dump({h:[r["items"] for r in rs] for h,rs in own_rows.items()}, open(f"{S}/own_items.json","w"))
print("\nsample rune record:", next((r["runes"][:3] for r in allo if r["runes"]), None))
print("sample item record:", next((r["items"][:5] for r in allo if r["items"]), None))
