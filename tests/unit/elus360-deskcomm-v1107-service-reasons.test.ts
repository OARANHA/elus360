import { describe, expect, it } from "vitest";

import { MOTIVOS_DO_SERVICO } from "@/lib/agenda/servicos/motivos";

describe("Deskcomm v1.107.0 — vocabulário aditivo de reservas", () => {
  it("preserva os motivos anteriores à v1.107.0 sem alterar os textos", () => {
    const anteriores = {
      service_not_found: "Serviço não encontrado.",
      service_inactive: "Este serviço não está ativo para novas reservas.",
      outside_schedule: "Fora da programação deste serviço.",
      outside_booking_window: "Fora do período permitido para reservar.",
      schedule_ambiguous: "Há horários sobrepostos na programação. Confira a configuração.",
      availability_unverified: "Disponibilidade não verificada. Confira a conexão do calendário.",
      publication_unavailable: "O calendário de destino não está disponível. Confira a conexão.",
      blocked: "Bloqueado para novas reservas. As reservas existentes permanecem.",
      capacity_reached: "A capacidade deste horário foi atingida.",
      professional_not_eligible: "Este profissional não está habilitado para o serviço.",
      professional_unavailable: "Nenhum profissional habilitado está disponível neste horário.",
      resource_unavailable: "Um recurso necessário está indisponível neste horário.",
      service_stale: "A configuração mudou. Consulte os horários novamente.",
    };
    for (const [codigo, mensagem] of Object.entries(anteriores)) {
      expect(MOTIVOS_DO_SERVICO[codigo], codigo).toBe(mensagem);
    }
  });

  it("expõe as nove mensagens adicionais da v1.107.0 sem depender de migrations", () => {
    const novas = [
      "space_required",
      "space_not_eligible",
      "space_unavailable",
      "space_capacity_reached",
      "party_exceeds_space_capacity",
      "party_invalid",
      "service_resource_in_use",
      "service_resource_invalid",
      "service_resource_not_found",
    ];
    for (const codigo of novas) {
      expect(MOTIVOS_DO_SERVICO[codigo], codigo).toEqual(expect.any(String));
      expect(MOTIVOS_DO_SERVICO[codigo]?.trim().length).toBeGreaterThan(0);
    }
    expect(Object.keys(MOTIVOS_DO_SERVICO)).toHaveLength(22);
  });
});
