// lib/audiolivro/zip.ts
//
// ZIP do audiolivro: um MP3 por capítulo (créditos nas pontas), com os nomes
// numerados na ordem em que o livro toca. Montado uma vez por versão dos
// capítulos e guardado no bucket; a tela recebe um link de download (1h).

import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET } from "@/lib/adaptadores/supabase";
import { md5 } from "@/lib/adaptadores/livros";
import type { DadosAudio } from "@/lib/adaptadores/tipos";
import { nomesDosArquivos } from "./nomes";
import type { Falha } from "./motor";

function nomeDoZip(titulo: string): string {
  const limpo = Array.from(titulo)
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join("")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${limpo || "audiolivro"} - audiolivro.zip`;
}

export async function linkDoZip(
  admin: SupabaseClient,
  livroId: string,
  titulo: string,
  dados: DadosAudio,
): Promise<{ ok: true; url: string } | Falha> {
  const narrados = dados.capitulos.filter((c) => c.trechos > 0);
  if (narrados.length === 0 || !narrados.every((c) => c.montado_em && c.storage_path)) {
    return { ok: false, status: 409, corpo: { error: "O audiolivro ainda não terminou.", reason: "nao_terminado" } };
  }
  const versao = md5(narrados.map((c) => `${c.index}:${c.montado_em}`).join("|")).slice(0, 12);
  const pasta = `${livroId}/zip`;
  const arquivo = `audiolivro-${versao}.zip`;
  const caminho = `${pasta}/${arquivo}`;
  const assinar = async () => {
    const { data } = await admin.storage.from(BUCKET).createSignedUrl(caminho, 3600, { download: nomeDoZip(titulo) });
    return data?.signedUrl ?? null;
  };

  const { data: lista } = await admin.storage.from(BUCKET).list(pasta, { search: arquivo });
  if ((lista ?? []).some((f) => f.name === arquivo)) {
    const url = await assinar();
    if (url) return { ok: true, url };
  }

  const nomes = nomesDosArquivos(dados.capitulos);
  const zip = new JSZip();
  for (const c of narrados) {
    const { data: blob, error } = await admin.storage.from(BUCKET).download(c.storage_path!);
    if (error || !blob) {
      console.error(`[zip] download do capítulo ${c.index}:`, error?.message);
      return { ok: false, status: 500, corpo: { error: "Falha ao juntar os arquivos." } };
    }
    zip.file(nomes.get(c.index) ?? `${c.index}.mp3`, new Uint8Array(await blob.arrayBuffer()), { compression: "STORE" });
  }
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const { error: errUp } = await admin.storage.from(BUCKET).upload(caminho, bytes, { contentType: "application/zip", upsert: true });
  if (errUp) {
    console.error("[zip] upload:", errUp.message);
    return { ok: false, status: 500, corpo: { error: "Falha ao preparar o ZIP." } };
  }
  const url = await assinar();
  return url ? { ok: true, url } : { ok: false, status: 500, corpo: { error: "Falha ao preparar o ZIP." } };
}
