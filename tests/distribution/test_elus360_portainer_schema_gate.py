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
        tables = gate.validate_contract(config, "v1.108.3")
        self.assertIn("importacoes_de_historico", tables)
        self.assertIn("runtime_confirmation", tables["system_version"])
        with self.assertRaises(ValueError):
            gate.validate_contract(config, "v1.102.0")
        with self.assertRaises(ValueError):
            gate.validate_contract(config, "v1.102.1")
        # v1.108.2 ja foi publicada com controller/contrato antigo.
        with self.assertRaises(ValueError):
            gate.validate_contract(config, "v1.108.2")

    def test_release_requires_phone_and_sector_runtime_dependencies(self):
        contract = json.loads((ROOT / "deploy" / "elus360-schema-contract.json").read_text())
        tables = gate.validate_contract(contract, "v1.108.3")
        self.assertEqual(len(tables), 11)
        self.assertTrue({"phone_type", "phone_whatsapp"} <= set(tables["contacts"]))
        self.assertIn("sector_id", tables["conversations"])
        self.assertTrue({"id", "organization_id", "contact_id", "phone_number",
                         "tipo", "whatsapp", "wa_lid"} <= set(tables["contact_phones"]))
        self.assertTrue({"id", "organization_id", "name", "schedule"}
                        <= set(tables["attendant_sectors"]))
        self.assertTrue({"organization_id", "user_id", "sector_id"}
                        <= set(tables["attendant_sector_members"]))

    def test_absent_phone_and_sector_tables_fail_closed_without_rows(self):
        contract = json.loads((ROOT / "deploy" / "elus360-schema-contract.json").read_text())
        tables = gate.validate_contract(contract, "v1.108.3")
        selected = []
        def opener(req, timeout):
            parsed = urlsplit(req.full_url)
            selected.append((parsed.path, parse_qs(parsed.query)))
            if parsed.path in ("/rest/v1/contact_phones", "/rest/v1/attendant_sectors"):
                raise HTTPError(req.full_url, 404, "module not installed", {}, None)
            return FakeResponse()
        failures = gate.check_schema("https://abcdefghijklmnopqrst.supabase.co", "fake", tables, opener)
        self.assertEqual(failures, ["contact_phones: HTTP 404", "attendant_sectors: HTTP 404"])
        self.assertEqual(len(selected), len(tables))
        self.assertTrue(all(req["limit"] == ["0"] for _, req in selected))
        self.assertFalse(any("fake" in repr(req) for req in selected))

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
