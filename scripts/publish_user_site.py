"""Publish only dist/ into the existing master:/feishu-file-export/ tree.

This optional route requires PAGES_DEPLOY_TOKEN for the destination repository.
Project Pages can be used without any cross-repository token.
"""
import base64
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request

TARGET = 'shandianchengzi/shandianchengzi.github.io'
BRANCH = 'master'
PREFIX = 'feishu-file-export/'


def dist_files(directory):
    root = Path(directory)
    if not (root / 'index.html').is_file():
        raise ValueError('dist/index.html is missing; build before publishing')
    result = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError('Refusing a symlink in dist')
        if path.is_file():
            result[PREFIX + path.relative_to(root).as_posix()] = path.read_bytes()
    return result


def main():
    token = os.environ.get('PAGES_DEPLOY_TOKEN')
    if not token:
        raise SystemExit('Set PAGES_DEPLOY_TOKEN with Contents and Pages write access to ' + TARGET + ', or select PAGES_MODE=project instead.')

    def api(method, path, payload=None):
        request = urllib.request.Request(
            'https://api.github.com/repos/' + TARGET + path,
            method=method,
            data=None if payload is None else json.dumps(payload).encode(),
            headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                     'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28'})
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.load(response)

    # Read this every time: never turn a whole-site deployment into a subfolder
    # deployment accidentally, or silently change the user's Pages settings.
    pages = api('GET', '/pages')
    if pages.get('build_type') != 'legacy' or pages.get('source') != {'branch': BRANCH, 'path': '/'}:
        raise SystemExit('Expected existing branch-based Pages from master root; no files were published.')
    files = dist_files('dist')
    source_sha = os.environ.get('SOURCE_SHA', '')
    files[PREFIX + 'deployment.json'] = json.dumps({'source': 'shandianchengzi/feishu-file-export', 'commit': source_sha}).encode()
    entries = []
    for path, data in files.items():
        blob = api('POST', '/git/blobs', {'encoding': 'base64', 'content': base64.b64encode(data).decode()})
        entries.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
    for attempt in range(3):
        head = api('GET', '/commits/' + BRANCH)
        tree = api('POST', '/git/trees', {'base_tree': head['commit']['tree']['sha'], 'tree': entries})
        commit = api('POST', '/git/commits', {'message': 'Publish Feishu file exporter ' + source_sha[:12],
                     'parents': [head['sha']], 'tree': tree['sha']})
        try:
            api('PATCH', '/git/refs/heads/' + BRANCH, {'sha': commit['sha'], 'force': False})
            print('Published plugin files at commit ' + commit['sha'])
            break
        except urllib.error.HTTPError as error:
            if error.code not in (409, 422) or attempt == 2:
                raise
            time.sleep(1)
    build = api('POST', '/pages/builds', {})
    print('Requested Pages build: ' + build.get('status', 'accepted'))


if __name__ == '__main__':
    main()
