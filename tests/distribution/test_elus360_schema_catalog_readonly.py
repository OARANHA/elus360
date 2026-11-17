"""ELUS360 read-only runtime schema inventory: offline guard for PII/DDL safety."""
from pathlib import Path
import re
import unittest

SQL = (Path(__file__).resolve().parents[2] /
       "scripts/elus360-schema-catalog-readonly.sql").read_text(encoding="utf-8")


class RuntimeSchemaCatalogAudit(unittest.TestCase):
    def test_only_catalog_reads_and_no_tenant_rows(self):
        body = re.sub(r"(?m)^\s*--.*(?:\n|$)", "", SQL)
        self.assertRegex(body.lstrip(), r"^WITH required\(")
        self.assertEqual(body.count(";"), 1)
        self.assertFalse(re.search(r"(?im)^\s*(?:create|alter|drop|insert|update|delete|truncate|grant|revoke|do|call|copy|notify|set|reset|begin|commit|rollback)\b", body))
        self.assertNotRegex(body, r"(?i)\b(?:from|join)\s+public\.")
        self.assertIn("pg_catalog", SQL)
        self.assertIn("to_regprocedure(", body)
        self.assertIn("pg_policies", body)
        self.assertIn("pg_trigger", body)
        self.assertIn("pg_constraint", body)
        self.assertIn("pg_index", body)

    def test_presence_contract_counts_and_cross_tenant_guards(self):
        entries = re.findall(
            r"(?m)^\s*\('(table|column|function|policy|policy_contains|trigger|foreign_key|primary_key|index|rls)',\s*'([^']+)'",
            SQL)
        self.assertEqual(len(entries), 32)
        self.assertEqual(len(set(entries)), 32)
        self.assertIn(("table", "attendant_sector_members"), entries)
        self.assertIn(("column", "conversations.sector_id"), entries)
        self.assertIn(("function", "fn_conversation_sector_scope()"), entries)
        self.assertIn(("policy_contains", "conversations.conversations_select:sector"), entries)
        self.assertIn(("foreign_key", "conversations.conversations_sector_fk"), entries)
        self.assertIn(("rls", "contact_phones.RLS_ENABLED"), entries)
        self.assertIn(("trigger", "contacts.trg_contacts_um_numero_uma_ficha"), entries)
        self.assertIn("k.convalidated", SQL)
        self.assertIn("x.indisvalid AND x.indisready", SQL)
        self.assertIn("t.tgenabled IN ('O','A')", SQL)


if __name__ == "__main__":
    unittest.main()
