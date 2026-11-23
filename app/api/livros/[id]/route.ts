// GET /api/livros/[id] — o livro, a prévia dos capítulos, o andamento e os
// links dos capítulos prontos. Quem tem o link pode ouvir; refazer e editar
// pedem o token (rotas próprias).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/adaptadores/supabase";
import { lerLivro, tokenConfere } from "@/lib/adaptadores/livros";
import { LIMITE_CARACTERES, LIMITE_REGENERACOES } from "@/lib/adaptadores/limites";
import { linksDosCapitulos, livroParaAudio, nomesDosCapitulos, previaDoLivro, segmentosDoLivro, statusAudiolivro } from "@/lib/audiolivro/motor";
import { nomesCandidatos } from "@/lib/audiolivro/candidatos";
import { AUDIO_VOZES } from "@/lib/audiolivro/config";
import { erro } from "@/lib/api/respostas";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = supabaseAdmin();
  const livro = await lerLivro(admin, id);
  if (!livro) return erro(404, "Livro não encontrado.");
  const dono = await tokenConfere(admin, id, req);
  const paraAudio = livroParaAudio(livro);
  const previa = previaDoLivro(paraAudio);
  const dados = livro.dados;
  const status = await statusAudiolivro(admin, id, dados);
  const links = dados ? await linksDosCapitulos(admin, dados) : {};
  const nomes = dados ? nomesDosCapitulos(dados) : new Map<number, string>();

  return NextResponse.json({
    livro: {
      id: livro.id,
      titulo: livro.titulo,
      subtitulo: livro.subtitulo,
      autor: livro.autor,
      cortado: livro.cortado,
      exemplo: livro.exemplo,
    },
    dono,
    limite_caracteres: LIMITE_CARACTERES,
    previa,
    vozes: AUDIO_VOZES,
    // Nomes próprios mais frequentes, para o autor dizer como se pronunciam.
    nomes: !dados && dono ? nomesCandidatos(segmentosDoLivro(paraAudio).map((s) => s.texto), 12) : [],
    audio: dados
      ? {
          voz: dados.voz,
          pronuncias: dados.pronuncias,
          regeneracoes_usadas: dados.regeneracoes_usadas,
          regeneracoes_limite: LIMITE_REGENERACOES,
          capitulos: dados.capitulos.map((c) => ({
            index: c.index,
            titulo: c.titulo,
            trechos: c.trechos,
            duracao_ms: c.montado_em ? c.duracao_ms : null,
            url: links[c.index] ?? null,
            arquivo: nomes.get(c.index) ?? null,
          })),
        }
      : null,
    status,
  });
}
