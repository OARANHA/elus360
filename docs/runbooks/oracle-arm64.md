# Oracle Ampere A1 (ARM64) — não suportado pelo ELUS360

> **DESCONTINUADO para o fork ELUS360.** Este runbook antigo do DeskcommCRM
> não deve ser utilizado para instalar ou atualizar o ELUS360.

## Política em vigor

A [ADR-0007](../adr/0007-elus360-linux-amd64.md), aprovada em 07/11/2026,
restringe **todos os servidores de instalação e atualização ELUS360 a
Linux AMD64 (x86_64)**. Máquinas ARM64/aarch64, incluindo Oracle
`VM.Standard.A1.Flex`, são recusadas com `ELUS_DISTRIBUTION_NO_GO` antes
de alterar imagens, configurações, contêineres ou banco. Não existe fallback
de compilação local, suporte especial a instalação existente nem promessa de
suporte ARM64 futuro.

**Para executar o ELUS360:** escolha uma VPS com **Linux AMD64 (x86_64)**,
com os recursos exigidos pelo modo de instalação escolhido. Utilize o
instalador e o atualizador oficiais **somente depois** das validações de release
publicada, quatro imagens GHCR AMD64, backup e rollback. Consulte as
instruções da distribuição e a ADR-0007 para o aceite atual.

Clientes podem utilizar navegadores em dispositivos ARM64 normalmente:
a restrição aplica-se à arquitetura do **servidor**, não ao computador ou
celular que acessa o CRM.

**Estado:** instruções ARM64 históricas do upstream foram desativadas.
Este arquivo não contém procedimento operacional de instalação em ARM64.
