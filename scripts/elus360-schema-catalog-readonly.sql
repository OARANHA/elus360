-- ELUS360 PR #42 — inventario de dependencias de runtime da v1.108.1.
-- SOMENTE LEITURA: executa SELECT sobre pg_catalog, sem acessar linhas de tenants.
-- A presenca dos objetos NAO certifica politica RLS, SQL de funcoes, grants,
-- correspondencia semantica com migrations nem preparo para deploy.
-- Fonte: 0801, 9043, 9048, 9062, 9084 e 9214 do fork.
-- Banco: execute em ambiente autorizado, nunca como migration.
WITH required(kind, label, rel, member) AS (
  VALUES
    ('table', 'contacts', 'contacts', NULL),
    ('table', 'conversations', 'conversations', NULL),
    ('table', 'contact_phones', 'contact_phones', NULL),
    ('table', 'attendant_sectors', 'attendant_sectors', NULL),
    ('table', 'attendant_sector_members', 'attendant_sector_members', NULL),
    ('column', 'contacts.phone_type', 'contacts', 'phone_type'),
    ('column', 'contacts.phone_whatsapp', 'contacts', 'phone_whatsapp'),
    ('column', 'conversations.sector_id', 'conversations', 'sector_id'),
    ('column', 'attendant_sectors.schedule', 'attendant_sectors', 'schedule'),
    ('column', 'attendant_sectors.color', 'attendant_sectors', 'color'),
    ('column', 'contact_phones.wa_lid', 'contact_phones', 'wa_lid'),
    ('function', 'fn_telefone_canonico(text)', NULL, NULL),
    ('function', 'fn_tipo_do_telefone(text)', NULL, NULL),
    ('function', 'fn_contact_phones_um_numero_uma_ficha()', NULL, NULL),
    ('function', 'fn_contacts_um_numero_uma_ficha()', NULL, NULL),
    ('function', 'fn_conversation_sector_scope()', NULL, NULL),
    ('function', 'fn_tornar_telefone_principal(uuid,uuid,uuid)', NULL, NULL),
    ('function', 'fn_channel_routing_claim(uuid,uuid,uuid,uuid,jsonb,text)', NULL, NULL),
    ('policy', 'contact_phones.tenant_isolation_contact_phones_read', 'contact_phones', 'tenant_isolation_contact_phones_read'),
    ('policy', 'contact_phones.tenant_isolation_contact_phones_write', 'contact_phones', 'tenant_isolation_contact_phones_write'),
    ('policy', 'attendant_sectors.tenant_isolation_attendant_sectors_select', 'attendant_sectors', 'tenant_isolation_attendant_sectors_select'),
    ('policy', 'attendant_sector_members.tenant_isolation_attendant_sector_members_select', 'attendant_sector_members', 'tenant_isolation_attendant_sector_members_select'),
    ('policy_contains', 'conversations.conversations_select:sector', 'conversations', 'fn_conversation_sector_scope'),
    ('trigger', 'contacts.trg_contacts_um_numero_uma_ficha', 'contacts', 'trg_contacts_um_numero_uma_ficha'),
    ('trigger', 'contact_phones.trg_contact_phones_um_numero_uma_ficha', 'contact_phones', 'trg_contact_phones_um_numero_uma_ficha'),
    ('foreign_key', 'conversations.conversations_sector_fk', 'conversations', 'conversations_sector_fk'),
    ('primary_key', 'attendant_sector_members.attendant_sector_members_pkey', 'attendant_sector_members', 'attendant_sector_members_pkey'),
    ('index', 'contact_phones.uniq_contact_phones_org_numero', 'contact_phones', 'uniq_contact_phones_org_numero'),
    ('index', 'attendant_sectors.attendant_sectors_org_name_unique', 'attendant_sectors', 'attendant_sectors_org_name_unique'),
    ('rls', 'contact_phones.RLS_ENABLED', 'contact_phones', NULL),
    ('rls', 'attendant_sectors.RLS_ENABLED', 'attendant_sectors', NULL),
    ('rls', 'attendant_sector_members.RLS_ENABLED', 'attendant_sector_members', NULL)
)
SELECT kind, label,
  CASE kind
    WHEN 'table' THEN to_regclass('public.' || rel) IS NOT NULL
    WHEN 'column' THEN EXISTS (
      SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = rel AND a.attname = member
        AND a.attnum > 0 AND NOT a.attisdropped
    )
    WHEN 'function' THEN to_regprocedure('public.' || label) IS NOT NULL
    WHEN 'policy' THEN EXISTS (
      SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public'
        AND p.tablename = rel AND p.policyname = member
    )
    WHEN 'policy_contains' THEN EXISTS (
      SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public'
        AND p.tablename = rel AND p.policyname = 'conversations_select'
        AND p.qual LIKE '%' || member || '%'
    )
    WHEN 'trigger' THEN EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = rel AND t.tgname = member
        AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal
    )
    WHEN 'foreign_key' THEN EXISTS (
      SELECT 1 FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = rel AND k.conname = member
        AND k.contype = 'f' AND k.convalidated
    )
    WHEN 'primary_key' THEN EXISTS (
      SELECT 1 FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = rel AND k.conname = member
        AND k.contype = 'p'
    )
    WHEN 'index' THEN EXISTS (
      SELECT 1 FROM pg_index x JOIN pg_class t ON t.oid = x.indrelid
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = rel AND i.relname = member
        AND x.indisvalid AND x.indisready
    )
    WHEN 'rls' THEN EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = rel AND c.relrowsecurity
    )
  END AS present
FROM required
ORDER BY kind, label;
