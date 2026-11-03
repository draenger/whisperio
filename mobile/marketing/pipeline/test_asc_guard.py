#!/usr/bin/env python3
"""Guard test: the ASC helpers must never write to App Review submission resources.

    python3 -m unittest test_asc_guard.py   (from this directory)
"""
import unittest
from unittest import mock

import asc_common as asc


class ReviewSubmissionGuardTest(unittest.TestCase):
    def setUp(self):
        # Fail loudly if anything reaches the network or mints a token.
        self.run_patch = mock.patch.object(asc.subprocess, "run", side_effect=AssertionError("network reached"))
        self.token_patch = mock.patch.object(asc, "token", side_effect=AssertionError("token minted"))
        self.run_patch.start()
        self.token_patch.start()
        asc._TOKEN = None

    def tearDown(self):
        mock.patch.stopall()
        asc._TOKEN = None

    def test_refuses_every_submission_write(self):
        for method in ("POST", "PATCH", "DELETE", "post"):
            for res in asc.FORBIDDEN_WRITE_RESOURCES:
                for url in (f"{asc.API}/{res}", f"{asc.API}/{res}/abc123", f"{asc.API}/{res}?include=items"):
                    with self.subTest(method=method, url=url):
                        with self.assertRaises(asc.ReviewSubmissionForbidden):
                            asc.call(method, url, {"data": {}})

    def test_case_insensitive_path(self):
        with self.assertRaises(asc.ReviewSubmissionForbidden):
            asc.call("POST", f"{asc.API}/REVIEWSUBMISSIONS", {})

    def test_get_is_allowed_through_the_guard(self):
        # GET passes the guard and then hits the (patched) token minting.
        with self.assertRaisesRegex(AssertionError, "token minted"):
            asc.call("GET", f"{asc.API}/reviewSubmissions?filter[app]={asc.APP_ID}")

    def test_metadata_writes_are_not_blocked(self):
        for url in (f"{asc.API}/appStoreReviewDetails", f"{asc.API}/appScreenshots/1",
                    f"{asc.API}/appStoreVersionLocalizations/1"):
            with self.subTest(url=url):
                with self.assertRaisesRegex(AssertionError, "token minted"):
                    asc.call("PATCH", url, {"data": {}})


if __name__ == "__main__":
    unittest.main()
