"""Rebuild the portable, offline edition of the exported concept, with Python 3.

The first export used visualize/scripts/render.py. This local generator keeps
its isolated srcdoc frame, embeds Lucide and restores the host design controls.
No Codex installation, network, package installation or application build needed.
"""
from pathlib import Path
from html import escape
import sys

BASE = Path(__file__).resolve().parent

def script(source):
    return '<script>' + source.replace('</script', '<\\/script') + '</script>'

def render():
    fragment = (BASE / 'notenverwaltung-ansichten.fragment.html').read_text(encoding='utf-8')
    icons = (BASE / 'vendor/lucide-1.17.0.js').read_text(encoding='utf-8')
    controls = (BASE / 'standalone-controls.js').read_text(encoding='utf-8')
    csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    frame = '''<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="''' + csp + '''">
<style>
html,body{margin:0;padding:0;background:transparent}
#hwg-concepts .hwg-standalone-controls{flex-basis:100%;color:var(--hwg-muted)}
#hwg-concepts .hwg-standalone-fields{display:flex;gap:20px;flex-wrap:wrap;padding-top:12px}
#hwg-concepts .hwg-standalone-fields>.hwg-field{flex:1;min-width:160px;max-width:280px}
</style></head><body>''' + script(icons) + script(controls) + fragment + '</body></html>'
    return '''<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="''' + csp + '''; frame-src 'self'">
<title>Notenverwaltung – UI-Konzepte 07 · Offline-Vorschau</title>
<style>:root{color-scheme:light dark}html,body{margin:0;min-height:100%;background:#17152b}iframe{display:block;width:100%;height:100vh;border:0}</style>
</head><body><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" title="Notenverwaltung – UI-Konzepte 07" srcdoc="''' + escape(frame) + '"></iframe></body></html>\n'

if __name__ == '__main__':
    target = BASE / 'notenverwaltung-ansichten.html'
    content = render()
    if '--check' in sys.argv:
        if target.read_text(encoding='utf-8') != content:
            raise SystemExit('Preview differs; run python docs/ui/concepts/build-preview.py')
        print('Offline preview matches source, controls and vendored icons.')
    else:
        target.write_text(content,encoding='utf-8',newline='\n')
        print(target)
