"""Check local Markdown destinations in the public concept documentation."""
from pathlib import Path
import re
from urllib.parse import unquote

root = Path(__file__).resolve().parents[4]
files = [root/'docs/ui/concepts/README.md', root/'docs/quality/PUBLICATION.md']
broken = []
checked = 0
for file in files:
    text = file.read_text(encoding='utf-8')
    for target in re.findall(r'\]\(([^)]+)\)', text):
        if '://' in target or target.startswith('#'):
            continue
        target = unquote(target.split('#')[0])
        checked += 1
        if not (file.parent/target).exists():
            broken.append(f'{file.relative_to(root)} -> {target}')
if broken:
    raise SystemExit('\n'.join(broken))
print(f'{checked} local documentation links resolve across {len(files)} public documents.')
