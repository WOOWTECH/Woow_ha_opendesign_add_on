#!/usr/bin/env python3
"""Branch-only candidate plan and immutable GHCR checks; never creates a Release."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

REPOSITORY = 'woowtech/woow-ha-opendesign-amd64'
ACCEPT = 'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'
CORE = re.compile(r'(?:ghcr\.io/woowtech/open-design-core(?::[0-9]{8}\.[0-9]{4})?|jcr-prod\.woowtech\.io/woow-paas-docker-local/open-design-core:[0-9]{8}\.[0-9]{4}(?:-pending-approval)?)@sha256:[a-f0-9]{64}')


def plan(env, config):
    if env.get('GITHUB_EVENT_NAME') != 'workflow_dispatch' or env.get('GITHUB_REPOSITORY') != 'WOOWTECH/Woow_ha_opendesign_add_on':
        raise ValueError('candidate publication requires a dispatch in the canonical repository')
    ref = env.get('GITHUB_REF', '')
    if not ref.startswith('refs/heads/') or ref == 'refs/heads/main':
        raise ValueError('candidate publication requires a non-main branch')
    core = env.get('CANDIDATE_CORE_IMAGE', '')
    if not CORE.fullmatch(core) or core.endswith('0' * 64):
        raise ValueError('candidate core must be the approved core repository pinned by sha256')
    version = re.search(r'^version: "([0-9]+\.[0-9]+\.[0-9]+)"$', config, re.M)
    if not version:
        raise ValueError('config.yaml must contain a stable semantic version')
    run, attempt = env.get('GITHUB_RUN_ID', ''), env.get('GITHUB_RUN_ATTEMPT', '')
    if not all(re.fullmatch(r'[1-9][0-9]*', value) for value in (run, attempt)):
        raise ValueError('invalid workflow run identity')
    sha = env.get('GITHUB_SHA', '')
    if not re.fullmatch(r'[a-f0-9]{40}', sha):
        raise ValueError('invalid source commit')
    version = f'{version[1]}-rc.{run}.{attempt}'
    return {'version': version, 'image': f'ghcr.io/{REPOSITORY}:{version}', 'core': core, 'source': sha}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise ValueError('unexpected registry redirect')


def manifest(version, authenticated=False, opener=None):
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+-rc\.[1-9][0-9]*\.[1-9][0-9]*', version):
        raise ValueError('refusing a non-candidate tag')
    opener = opener or urllib.request.build_opener(NoRedirect()).open
    headers = {}
    if authenticated:
        actor, token = os.environ['GHCR_ACTOR'], os.environ['GHCR_TOKEN']
        if not actor or not token:
            raise ValueError('registry credentials required')
        headers['Authorization'] = 'Basic ' + base64.b64encode(f'{actor}:{token}'.encode()).decode()
    query = urllib.parse.urlencode({'service': 'ghcr.io', 'scope': f'repository:{REPOSITORY}:pull'})
    with opener(urllib.request.Request('https://ghcr.io/token?' + query, headers=headers), timeout=30) as response:
        body = json.load(response)
    token = body.get('token') or body.get('access_token')
    if not token:
        raise ValueError('no registry read token')
    request = urllib.request.Request(f'https://ghcr.io/v2/{REPOSITORY}/manifests/{version}', headers={'Authorization': 'Bearer ' + token, 'Accept': ACCEPT})
    try:
        with opener(request, timeout=30) as response:
            raw = response.read()
            digest = response.headers.get('Docker-Content-Digest')
            if digest != 'sha256:' + hashlib.sha256(raw).hexdigest():
                raise ValueError('registry manifest digest mismatch')
            return digest
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise ValueError(f'registry returned HTTP {error.code}') from None


def main():
    result = plan(os.environ, Path('config.yaml').read_text())
    action = sys.argv[1]
    if action == 'plan':
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            for key, value in result.items():
                print(f'{key}={value}', file=output)
    elif action == 'preflight':
        if manifest(result['version'], authenticated=True) is not None:
            raise ValueError('candidate tag already exists; refusing overwrite')
    elif action == 'verify':
        digest = manifest(result['version'])  # Must be readable without credentials.
        expected = os.environ.get('PUSHED_DIGEST')
        if not digest or not re.fullmatch(r'sha256:[a-f0-9]{64}', expected or '') or digest != expected:
            raise ValueError('anonymous manifest differs from the image pushed after smoke')
        result.update(digest=digest, immutable_image=f'ghcr.io/{REPOSITORY}@{digest}',
                      runtime=json.loads(Path('paseo-runtime/VENDOR.json').read_text()), container_smoke='passed')
        Path('candidate-receipt.json').write_text(json.dumps(result, indent=2) + '\n')
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
            summary.write('Candidate container smoke passed; anonymous manifest verified.\n\n```json\n' + json.dumps(result, indent=2) + '\n```\n')
        print(json.dumps(result))
    else:
        raise ValueError('unknown candidate action')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, urllib.error.URLError) as error:
        # Never print request objects, tokens, registry response bodies or auth files.
        print(f'Candidate publication refused: {type(error).__name__}', file=sys.stderr)
        sys.exit(1)
