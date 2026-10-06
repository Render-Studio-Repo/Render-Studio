"""Browser regression for VR Viser import, sharing, and reconnect races."""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:8001')
parser.add_argument('--output', default='/tmp/viser-room-runtime.json')
args = parser.parse_args()
index = (ROOT / 'frontend/index.html').read_text()
imports = re.search(r'<script type="importmap">(.*?)</script>', index, re.S).group(1)
html = '<html><script type="importmap">' + imports + '</script><body></body></html>'
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('**/__viser-room-test', lambda r: r.fulfill(body=html, content_type='text/html'))
    page.goto(args.base_url + '/__viser-room-test')
    report = page.evaluate(Path(__file__).with_suffix('.js').read_text())
    report['pageErrors'] = errors
    assert not errors, errors
    Path(args.output).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    browser.close()
