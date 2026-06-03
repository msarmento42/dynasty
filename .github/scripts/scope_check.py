#!/usr/bin/env python3
"""AGIOS scope check — dynasty."""
import subprocess, sys, re

blocked = [".github/", ".agios/", "*.env*", "*.db", "logs/", "data/"]

result = subprocess.run(
    ["git", "diff", "--name-only", "origin/main...HEAD"],
    capture_output=True, text=True
)
changed = [f.strip() for f in result.stdout.splitlines() if f.strip()]

violations = []
for f in changed:
    for b in blocked:
        pattern = b.replace("*", ".*").replace("/", "/")
        if re.match(f"^{pattern}", f) or f == b.rstrip("/"):
            violations.append(f"BLOCKED: {f} matches rule '{b}'")

if violations:
    for v in violations: print(v)
    sys.exit(1)
print(f"Scope OK — {len(changed)} file(s) changed.")
