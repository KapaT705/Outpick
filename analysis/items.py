import json, sys, collections
S = sys.argv[1]
items = {i["id"]: i["displayName"] for i in json.load(open(f"{S}/items.json"))["data"]["constants"]["items"]}
own = json.load(open(f"{S}/own_stats.json"))["data"]["player"]["matches"]
KEY = {"Invoker":[74,{"Hand of Midas","Orchid Malevolence","Black King Bar","Aghanim's Scepter","Boots of Travel","Refresher Orb","Octarine Core","Scythe of Vyse","Blink Dagger","Witch Blade"}],
       "Lina":[25,{"Black King Bar","Aghanim's Scepter","Boots of Travel","Dragon Lance","Hurricane Pike","Daedalus","Maelstrom","Gleipnir","Monkey King Bar","Satanic","Falcon Blade","Witch Blade"}],
       "Queen of Pain":[39,{"Orchid Malevolence","Black King Bar","Aghanim's Scepter","Scythe of Vyse","Kaya and Sange","Bloodthorn","Witch Blade","Falcon Blade","Maelstrom"}],
       "Earthshaker":[7,{"Blink Dagger","Aghanim's Scepter","Black King Bar","Boots of Travel","Echo Sabre","Harpoon","Shadow Blade","Aether Lens"}],
       "Ember Spirit":[106,{"Maelstrom","Black King Bar","Daedalus","Blade Mail","Mjollnir","Gleipnir","Aghanim's Scepter","Kaya and Sange","Shiva's Guard","Phase Boots"}],
       "Rubick":[86,{"Aghanim's Scepter","Blink Dagger","Boots of Travel","Aether Lens","Black King Bar","Kaya and Sange","Scythe of Vyse","Witch Blade","Rod of Atos"}]}
print("=== Your first-purchase timing of key items (avg minute, games bought/total) ===")
for name,(hid,keys) in KEY.items():
    rows = [m["players"][0] for m in own if m["players"][0]["heroId"]==hid and (m["players"][0].get("stats") or {}).get("itemPurchases")]
    if not rows: continue
    firsts = collections.defaultdict(list)
    for p in rows:
        seen=set()
        for it in p["stats"]["itemPurchases"]:
            n = items.get(it["itemId"]); 
            if n in keys and n not in seen: seen.add(n); firsts[n].append(it["time"]/60)
    out = sorted(((n, sum(v)/len(v), len(v)) for n,v in firsts.items()), key=lambda x: x[1])
    print(f"{name} (n={len(rows)}): " + ", ".join(f"{n} {t:.0f}m ({c}/{len(rows)})" for n,t,c in out))
# Invoker bench
b = json.load(open(f"{S}/inv_items_bench.json"))["data"]["heroStats"]["itemFullPurchase"]
print("\n=== Divine/Immortal Invoker mid: popular items, avg purchase minute, winrate when bought ===")
for r in sorted(b, key=lambda r: -r["matchCount"])[:14]:
    print(f"  {items.get(r['itemId'],r['itemId']):22s} {r['time']/60:5.1f}m  games {r['matchCount']:6d}  WR {r['winCount']/r['matchCount']*100:.0f}%")
# runes vs top
def runes_per_game(ms):
    c=n=0
    for m in ms:
        st=(m["players"][0].get("stats") or {})
        if st.get("runes") is None: continue
        n+=1; c+=sum(1 for r in st["runes"] if r.get("action") in (None,"PICKUP"))
    return c/n if n else None, n
top=[]
for i in (1,2,3):
    for v in json.load(open(f"{S}/top_{i}.json"))["data"].values(): top.extend(v["matches"])
print(f"\nRune pickups per game: you {runes_per_game(own)[0]:.1f}  / top {runes_per_game(top)[0]:.1f}")
print("note: top data has no action field, so top count includes bottle actions; own count is PICKUP only")
o2 = sum(len((m['players'][0].get('stats') or {}).get('runes') or []) for m in own)/len(own)
print(f"Rune records per game incl. bottle: you {o2:.1f} / top {runes_per_game(top)[0]:.1f}")
