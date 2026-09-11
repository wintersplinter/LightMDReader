"""Diff two render sets. Exit 1 if anything differs."""
import sys, os
from PIL import Image, ImageChops

a_dir, b_dir = sys.argv[1], sys.argv[2]
names = sorted(set(os.listdir(a_dir)) | set(os.listdir(b_dir)))
names = [n for n in names if n.endswith(".png")]

worst = []
missing = []
for n in names:
    pa, pb = os.path.join(a_dir, n), os.path.join(b_dir, n)
    if not (os.path.exists(pa) and os.path.exists(pb)):
        missing.append(n); continue
    A, B = Image.open(pa).convert("RGB"), Image.open(pb).convert("RGB")
    if A.size != B.size:
        worst.append((n, -1, f"size {A.size} vs {B.size}")); continue
    diff = ImageChops.difference(A, B)
    bbox = diff.getbbox()
    if bbox is None:
        continue
    px = sum(1 for p in diff.getdata() if p != (0, 0, 0))
    total = A.size[0] * A.size[1]
    worst.append((n, px, f"{100*px/total:.3f}% of {total} px, region {bbox}"))

print(f"compared {len(names)} renders")
if missing:
    print(f"  MISSING on one side: {len(missing)}")
    for n in missing[:8]: print(f"    {n}")
if not worst and not missing:
    print("  IDENTICAL — no visible change")
    sys.exit(0)
print(f"  differing: {len(worst)}")
for n, px, note in sorted(worst, key=lambda x: -x[1])[:24]:
    print(f"    {n:<44} {note}")
sys.exit(1)
