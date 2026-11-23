// POST /api/livros/[id]/preparar — { voz, pronuncias } — divide o livro em
// trechos e põe na fila. Só quem enviou (token). Conta no limite diário.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/adaptadores/supabase";
import { hashDoEndereco, lerLivro, narracoesRecentes, tokenConfere } from "@/lib/adaptadores/livros";
import { LIMITE_LIVROS_DIA, LIMITE_LIVROS_IP_DIA } from "@/lib/adaptadores/limites";
import { livroParaAudio, prepararAudiolivro } from "@/lib/audiolivro/motor";
import { daFalha, erro } from "@/lib/api/respostas";

export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = supabaseAdmin();
  if (!(await tokenConfere(admin, id, req))) return erro(403, "Só quem enviou o livro pode narrar.");
  const livro = await lerLivro(admin, id);
  if (!livro) return erro(404, "Livro não encontrado.");
  if (!livro.capitulos) return erro(409, "Aprove os capítulos antes de narrar.", { reason: "capitulos" });
  const body = (await req.json().catch(() => ({}))) as { voz?: unknown; pronuncias?: unknown };

  // Primeira narração deste livro conta no limite do dia.
  if (!livro.dados && !livro.exemplo) {
    const uso = await narracoesRecentes(admin, hashDoEndereco(req));
    if (uso.total >= LIMITE_LIVROS_DIA) {
      return erro(429, "A demonstração atingiu o limite de livros narrados hoje. Tente de novo amanhã.", { reason: "limite_dia" });
    }
    if (uso.doEndereco >= LIMITE_LIVROS_IP_DIA) {
      return erro(429, `Você já narrou ${LIMITE_LIVROS_IP_DIA} livros hoje. Tente de novo amanhã.`, { reason: "limite_endereco" });
    }
  } else if (livro.dados && body.voz !== livro.dados.voz) {
    return erro(409, "A voz não muda depois que a narração começou.", { reason: "voz_travada" });
  }

  const r = await prepararAudiolivro(admin, {
    livroId: id,
    livro: livroParaAudio(livro),
    voz: body.voz,
    pronuncias: body.pronuncias,
    atual: livro.dados,
  });
  if (!r.ok) return daFalha(r);
  return NextResponse.json({ ok: true, refazer: r.refazer });
}
