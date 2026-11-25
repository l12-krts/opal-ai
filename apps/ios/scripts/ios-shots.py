#!/usr/bin/env python3
"""Turns the iOS workflow's Screens log into image files.

    gh run view <run-id> --log --job <screens-job-id> > screens.log
    python3 apps/ios/scripts/ios-shots.py screens.log shots/

The job prints each screenshot as base64 between "BEGIN-SHOT <name>" and "END-SHOT" lines.
"""
import base64
import os
import re
import sys


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    log, out = sys.argv[1], sys.argv[2]
    stamp = re.compile(r"^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z ?")
    name, buf, count = None, [], 0
    with open(log, encoding="utf-8", errors="replace") as f:
        for raw in f:
            line = raw.rstrip("\r\n")
            # `gh run view --log` puts "job<TAB>step<TAB>" in front; the raw log a timestamp.
            if "\t" in line:
                line = line.split("\t")[-1]
            line = stamp.sub("", line).strip()
            if line.startswith("BEGIN-SHOT "):
                name, buf = line[len("BEGIN-SHOT "):].strip(), []
            elif line == "END-SHOT" and name:
                path = os.path.join(out, name)
                os.makedirs(os.path.dirname(path) or out, exist_ok=True)
                with open(path, "wb") as img:
                    img.write(base64.b64decode("".join(buf)))
                count += 1
                name = None
            elif name is not None:
                buf.append(line)
    print(f"{count} screenshots in {out}")


if __name__ == "__main__":
    main()
