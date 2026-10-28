import { describe, expect, it, vi } from "vitest";
import { executarSincronizacoesIndependentes } from "@/lib/ai/catalogo/fontes-independentes";

describe("cron de catálogos — isolamento entre fontes", () => {
  it("sincroniza Chutes mesmo quando OpenRouter falha", async () => {
    const openrouter = vi.fn().mockRejectedValue(new Error("OpenRouter indisponível"));
    const chutes = vi.fn().mockResolvedValue({ fonte: "chutes", gravados: 3 });
    const [a, b] = await executarSincronizacoesIndependentes(openrouter, chutes);
    expect(openrouter).toHaveBeenCalledOnce();
    expect(chutes).toHaveBeenCalledOnce();
    expect(a.status).toBe("rejected");
    expect(b).toEqual({ status: "fulfilled", value: { fonte: "chutes", gravados: 3 } });
  });

  it("sincroniza OpenRouter mesmo quando Chutes falha", async () => {
    const openrouter = vi.fn().mockResolvedValue({ fonte: "openrouter", gravados: 2 });
    const chutes = vi.fn().mockRejectedValue(new Error("Chutes indisponível"));
    const [a, b] = await executarSincronizacoesIndependentes(openrouter, chutes);
    expect(openrouter).toHaveBeenCalledOnce();
    expect(chutes).toHaveBeenCalledOnce();
    expect(a).toEqual({ status: "fulfilled", value: { fonte: "openrouter", gravados: 2 } });
    expect(b.status).toBe("rejected");
  });

  it("registra falha de ambas sem interromper a execução", async () => {
    const [a, b] = await executarSincronizacoesIndependentes(
      () => Promise.reject(new Error("OpenRouter")),
      () => Promise.reject(new Error("Chutes")),
    );
    expect(a.status).toBe("rejected");
    expect(b.status).toBe("rejected");
  });

  it("executa ambas as fontes mesmo com falha síncrona em uma delas", async () => {
    const chutes = vi.fn().mockResolvedValue("ok");
    const [a, b] = await executarSincronizacoesIndependentes(
      () => { throw new Error("falha imediata"); },
      chutes,
    );
    expect(a.status).toBe("rejected");
    expect(b).toEqual({ status: "fulfilled", value: "ok" });
    expect(chutes).toHaveBeenCalledOnce();
  });
});
