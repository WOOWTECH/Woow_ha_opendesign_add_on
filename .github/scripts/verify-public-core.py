#!/usr/bin/env python3
"""Require the public GHCR core tag to resolve to the exact approved digest."""

import hashlib
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

REPOSITORY = "woowtech/open-design-core"
CORE_REF = re.compile(r"^ghcr\.io/woowtech/open-design-core:(?P<tag>[0-9]{8}\.[0-9]{4})@(?P<digest>sha256:[a-f0-9]{64})$")
ACCEPT = ", ".join((
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.docker.distribution.manifest.v2+json",
))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise ValueError("unexpected registry redirect")


def verify(ref, opener=None):
    match = CORE_REF.fullmatch(ref)
    if not match:
        raise ValueError("core reference must be the public tag and a sha256 digest")
    opener = opener or urllib.request.build_opener(NoRedirect()).open
    query = urllib.parse.urlencode({
        "service": "ghcr.io",
        "scope": f"repository:{REPOSITORY}:pull",
    })
    with opener(urllib.request.Request(f"https://ghcr.io/token?{query}"), timeout=30) as response:
        token = json.load(response).get("token")
    if not token:
        raise ValueError("no anonymous GHCR read token")
    request = urllib.request.Request(
        f"https://ghcr.io/v2/{REPOSITORY}/manifests/{match['tag']}",
        headers={"Authorization": f"Bearer {token}", "Accept": ACCEPT},
    )
    try:
        with opener(request, timeout=30) as response:
            body = response.read()
            reported = response.headers.get("Docker-Content-Digest")
    except urllib.error.HTTPError as error:
        if error.code == 404:
            raise ValueError("public core tag is unavailable (HTTP 404)") from None
        raise ValueError(f"public core tag returned HTTP {error.code}") from None
    calculated = "sha256:" + hashlib.sha256(body).hexdigest()
    if reported != calculated or reported != match["digest"]:
        raise ValueError("public core tag digest differs from approved digest")
    if json.loads(body).get("schemaVersion") != 2:
        raise ValueError("public core manifest has no OCI schema version 2")
    return reported


if __name__ == "__main__":
    try:
        digest = verify(sys.argv[1])
    except (IndexError, ValueError, urllib.error.URLError, json.JSONDecodeError) as error:
        print(f"public core gate failed: {error}", file=sys.stderr)
        sys.exit(1)
    print(f"public core tag matches approved digest: {digest}")
