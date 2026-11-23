// lib/audiolivro/arquivos.ts
//
// D60-B3. Remove os arquivos do audiolivro de um livro no bucket
// "audiolivros". Os arquivos ficam em subpastas (<user>/<projeto>/trechos e
// .../capitulos), e o list() do Storage não desce em subpasta: por isso a
// limpeza geral de projeto (lib/apagar-projeto.ts) não os alcançava.
// Usado no vencimento (90 dias) e na exclusão do projeto. Best-effort:
// loga e devolve quantos removeu; nunca lança.
//
// SERVER-ONLY (recebe o client com service_role).

import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "audiolivros";
const SUBPASTAS = ["trechos", "capitulos", "amostras-nomes"]; // D60-C: amostras de nome

export async function removerArquivosDoAudiolivro(admin: SupabaseClient, userId: string, projectId: string): Promise<number> {
  let removidos = 0;
  for (const sub of SUBPASTAS) {
    const pasta = `${userId}/${projectId}/${sub}`;
    // Sempre relista do começo: o que foi removido some da listagem.
    for (let rodada = 0; rodada < 100; rodada++) {
      const { data, error } = await admin.storage.from(BUCKET).list(pasta, { limit: 100 });
      if (error) {
        console.warn(`[audiolivro] listar ${pasta}:`, error.message);
        break;
      }
      const caminhos = (data ?? []).filter((f) => f.id).map((f) => `${pasta}/${f.name}`);
      if (caminhos.length === 0) break;
      const { error: errRm } = await admin.storage.from(BUCKET).remove(caminhos);
      if (errRm) {
        console.warn(`[audiolivro] remover em ${pasta}:`, errRm.message);
        break;
      }
      removidos += caminhos.length;
    }
  }
  return removidos;
}
