"""Tests for the Portainer schema compatibility gate (offline, no network)."""
import importlib.util
import json
import pathlib
import unittest
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("gate", ROOT / "scripts" / "elus360-portainer-schema-gate.py")
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)


class FakeResponse:
    status = 200
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False


class GateTests(unittest.TestCase):
    def test_current_contract_exact_release(self):
        config = json.loads((ROOT / "deploy" / "elus360-schema-contract.json").read_text())
        tables = gate.validate_contract(config, "v1.102.1")
        self.assertIn("importacoes_de_historico", tables)
        self.assertIn("runtime_confirmation", tables["system_version"])
        with self.assertRaises(ValueError):
            gate.validate_contract(config, "v1.102.0")
        with self.assertRaises(ValueError):
            gate.validate_contract(config, "v1.103.0")

    def test_zero_rows_and_no_secret_in_url(self):
        urls = []
        def opener(req, timeout):
            urls.append(req.full_url)
            self.assertIn("Bearer secret", req.headers.values())
            return FakeResponse()
        failures = gate.check_schema("https://abcdefghijklmnopqrst.supabase.co", "secret", {"contacts": ["id","zip_code"]}, opener)
        self.assertEqual(failures, [])
        self.assertEqual(parse_qs(urlsplit(urls[0]).query), {"select": ["id,zip_code"], "limit": ["0"]})
        self.assertNotIn("secret", urls[0])

    def test_missing_column_fails_closed_without_leaking_body(self):
        def opener(req, timeout):
            raise HTTPError(req.full_url, 400, "column absent and secret", {}, None)
        self.assertEqual(gate.check_schema("https://abcdefghijklmnopqrst.supabase.co", "secret", {"contacts": ["zip_code"]}, opener), ["contacts: HTTP 400"])

    def test_invalid_contract_or_missing_credentials(self):
        with self.assertRaises(ValueError):
            gate.validate_contract({"schema_version":1,"release":"v1.102.0","tables":{"x;DROP":["id"]}}, "v1.102.0")
        with self.assertRaises(ValueError):
            gate.check_schema("http://example.test", "secret", {"contacts": ["id"]})
        with self.assertRaises(ValueError):
            gate.check_schema("https://example.test", "", {"contacts": ["id"]})


if __name__ == "__main__":
    unittest.main()
