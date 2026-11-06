from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent_env.core import LocalAgent


def main() -> int:
    if len(sys.argv) != 2:
        print('Usage: python scripts/dry_run_github.py "https://github.com/OWNER/REPO/tree/REF/PATH"', file=sys.stderr)
        return 2
    root = Path(os.environ.get("LOCAL_AGENT_HOME", Path(__file__).resolve().parents[1])).resolve()
    result = LocalAgent(root).install_skill_from_github(sys.argv[1], dry_run=True)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
