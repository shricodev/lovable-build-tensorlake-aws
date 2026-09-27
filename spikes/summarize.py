import json, glob, sys
for f in sorted(glob.glob("out/*.json")):
    d = json.load(open(f))
    print("==", d["name"], "FAILED" if d["failed"] else "")
    for s in d["steps"]:
        status = "ok  " if s["ok"] else "FAIL"
        err = "  ERR: " + s["error"][:220] if not s["ok"] else ""
        print(f"  {status} {s['ms']:>6}ms  {s['step']}{err}")
