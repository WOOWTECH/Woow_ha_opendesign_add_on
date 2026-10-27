#!/usr/bin/env python3
"""Anonymous tag identity is checked before any HA candidate or release image build."""

import hashlib
import importlib.util
import io
from pathlib import Path
import unittest
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("verify_public_core", ROOT / ".github/scripts/verify-public-core.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

MANIFEST = b'{"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json"}'
DIGEST = "sha256:" + hashlib.sha256(MANIFEST).hexdigest()
REF = f"ghcr.io/woowtech/open-design-core:20261027.0212@{DIGEST}"


class Response(io.BytesIO):
    def __init__(self, data, digest=None):
        super().__init__(data)
        self.headers = {"Docker-Content-Digest": digest} if digest else {}


class TestPublicCore(unittest.TestCase):
    def test_exact_anonymous_tag_matches_digest_and_body(self):
        requests = []

        def open_request(request, timeout):
            requests.append(request)
            if len(requests) == 1:
                return Response(b'{"token":"fixture"}')
            return Response(MANIFEST, DIGEST)

        self.assertEqual(module.verify(REF, open_request), DIGEST)
        self.assertIn("repository%3Awoowtech%2Fopen-design-core%3Apull", requests[0].full_url)
        self.assertEqual(requests[1].full_url, "https://ghcr.io/v2/woowtech/open-design-core/manifests/20261027.0212")
        self.assertIn("application/vnd.oci.image.manifest.v1+json", requests[1].headers["Accept"])

    def test_missing_public_tag_is_a_release_block(self):
        calls = 0

        def open_request(request, timeout):
            nonlocal calls
            calls += 1
            if calls == 1:
                return Response(b'{"token":"fixture"}')
            raise urllib.error.HTTPError(request.full_url, 404, "Not Found", None, None)

        with self.assertRaisesRegex(ValueError, "unavailable \(HTTP 404\)"):
            module.verify(REF, open_request)

    def test_tag_pointing_at_another_digest_is_rejected(self):
        calls = 0

        def open_request(request, timeout):
            nonlocal calls
            calls += 1
            if calls == 1:
                return Response(b'{"token":"fixture"}')
            return Response(MANIFEST, DIGEST)

        with self.assertRaisesRegex(ValueError, "differs from approved"):
            module.verify(REF.replace(DIGEST, "sha256:" + "0" * 64), open_request)

    def test_registry_digest_header_must_match_manifest_bytes(self):
        calls = 0

        def open_request(request, timeout):
            nonlocal calls
            calls += 1
            if calls == 1:
                return Response(b'{"token":"fixture"}')
            return Response(MANIFEST, "sha256:" + "0" * 64)

        with self.assertRaisesRegex(ValueError, "differs from approved"):
            module.verify(REF, open_request)

    def test_private_and_mutable_references_are_rejected_before_network(self):
        for ref in ("jcr-prod.woowtech.io/x:20261027.0212@" + DIGEST,
                    "ghcr.io/woowtech/open-design-core:latest@" + DIGEST,
                    "ghcr.io/woowtech/open-design-core:20261027.0212"):
            with self.subTest(ref=ref), self.assertRaisesRegex(ValueError, "public tag"):
                module.verify(ref, lambda *_args, **_kwargs: self.fail("network called"))


if __name__ == "__main__":
    unittest.main()
