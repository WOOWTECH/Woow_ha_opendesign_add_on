#!/usr/bin/env python3
"""Anonymous JCR reachability gate; emits metadata, never response HTML or auth.

This observes the actual runner's path with an honest application User-Agent.
It does not authenticate, fetch a token, retry a blocked route or prove that
Docker/skopeo authentication will succeed. Both callers run on Linux.
"""
import hashlib
import http.client
import json
import re
import signal
import sys
import time
import urllib.error
import urllib.request

ENDPOINT = 'https://jcr-prod.woowtech.io/v2/'
REALM = 'https://jcr-prod.woowtech.io/v2/token'
SERVICE = 'jcr-prod.woowtech.io'
USER_AGENT = ('WoowTech-HA-OpenDesign-RegistryPreflight/1.0 '
              '(+https://github.com/WOOWTECH/Woow_ha_opendesign_add_on)')
DEADLINE_SECONDS = 20
MAX_BODY_BYTES = 65536


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


class DeadlineExpired(Exception):
    pass


def expire_deadline(*args):
    raise DeadlineExpired()


def empty_result():
    return dict(status=None, content_type=None, server=None, cf_ray=None,
                error_code=None, body_sha256=None)


def safe_header(value, pattern):
    return value if value and re.fullmatch(pattern, value) else None


def valid_challenge(value):
    # Accept only one well-formed Bearer challenge for this known JCR endpoint.
    # Do not print the challenge or follow the advertised realm.
    scheme, _, params = value.partition(' ')
    if scheme.lower() != 'bearer' or not params or len(params) > 4096:
        return False
    parsed = {}
    for part in urllib.request.parse_http_list(params):
        match = re.fullmatch(r'([A-Za-z][A-Za-z0-9_-]*)\s*=\s*"([^"\\\x00-\x1f\x7f]*)"', part.strip())
        if not match or match[1].lower() in parsed:
            return False
        parsed[match[1].lower()] = match[2]
    return parsed.get('realm') == REALM and parsed.get('service', SERVICE) == SERVICE


def probe(open_url=None):
    if open_url is None:
        # Ignore ambient proxy credentials. The fixed HTTPS endpoint is public;
        # no auth, cookie or proxy handlers are installed for this anonymous GET.
        open_url = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open
    request = urllib.request.Request(ENDPOINT, method='GET', headers={
        'User-Agent': USER_AGENT, 'Accept': 'application/json',
    })
    try:
        response = open_url(request, timeout=DEADLINE_SECONDS)
    except urllib.error.HTTPError as error:
        response = error  # 401/403 bodies are diagnostics, never printed.
    result = empty_result()
    with response:
        result['status'] = response.status
        headers = {}
        ambiguous = False
        for key, value in response.headers.items():
            key = key.lower()
            if key in headers and key in ('www-authenticate', 'docker-distribution-api-version'):
                ambiguous = True
            headers[key] = value
        media_type = headers.get('content-type', '').split(';', 1)[0].strip().lower()
        result['content_type'] = safe_header(media_type, r'[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+')
        result['server'] = safe_header(headers.get('server'), r'[A-Za-z0-9][A-Za-z0-9 ._()/+-]{0,127}')
        result['cf_ray'] = safe_header(headers.get('cf-ray'), r'[0-9a-fA-F]{16,32}(?:-[A-Z0-9]{3,12})?')
        if response.geturl() != ENDPOINT:
            result['error_code'] = 'unexpected_endpoint'
            return result
        body = response.read(MAX_BODY_BYTES + 1)
    if len(body) > MAX_BODY_BYTES:
        result['error_code'] = 'response_too_large'
        return result  # A partial-body hash would be misleading.
    result['body_sha256'] = hashlib.sha256(body).hexdigest()
    status = result['status']
    if ambiguous:
        result['error_code'] = 'ambiguous_registry_headers'
    elif 300 <= status < 400:
        result['error_code'] = 'redirect_refused'
    elif status == 403:
        known = re.search(rb'\berror(?:\s+code)?\s*:?\s*(1010|1020)\b', body, re.I)
        result['error_code'] = 'cloudflare_' + known[1].decode('ascii') if known else 'http_403'
    elif status == 401:
        if not valid_challenge(headers.get('www-authenticate', '')):
            result['error_code'] = 'invalid_bearer_challenge'
    elif status == 200:
        if headers.get('docker-distribution-api-version', '').strip().lower() != 'registry/2.0':
            result['error_code'] = 'registry_header_missing_or_invalid'
        elif 'www-authenticate' in headers and not valid_challenge(headers['www-authenticate']):
            result['error_code'] = 'invalid_bearer_challenge'
    else:
        result['error_code'] = 'unexpected_http_status'
    return result


def main():
    result = empty_result()
    started = time.monotonic()
    old_handler = signal.signal(signal.SIGALRM, expire_deadline)
    old_timer = signal.setitimer(signal.ITIMER_REAL, DEADLINE_SECONDS)
    try:
        result = probe()
    except (DeadlineExpired, TimeoutError):
        result['error_code'] = 'network_timeout'
    except urllib.error.URLError as error:
        result['error_code'] = 'network_timeout' if isinstance(error.reason, TimeoutError) else 'network_error'
    except (OSError, http.client.HTTPException):
        result['error_code'] = 'network_error'
    except Exception:
        # Arbitrary exception strings may contain remote headers/body content.
        result['error_code'] = 'unexpected_response'
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, old_handler)
        if old_timer[0]:
            signal.setitimer(signal.ITIMER_REAL, max(0.001, old_timer[0] - (time.monotonic() - started)), old_timer[1])
    print(json.dumps(result, sort_keys=True))
    return 1 if result['error_code'] else 0


if __name__ == '__main__':
    sys.exit(main())
