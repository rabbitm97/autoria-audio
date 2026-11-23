// GET /api/livros/[id] — o livro e em que etapa está. A narração tem a
// própria rota (/api/audiolivro/[id]).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/adaptadores/supabase";
import { lerLivro, tokenConfere } from "@/lib/adaptadores/livros";
import { erro } from "@/lib/api/respostas";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = supabaseAdmin();
  const livro = await lerLivro(admin, id);
  if (!livro) return erro(404, "Livro não encontrado.");
  return NextResponse.json({
    livro: { id: livro.id, titulo: livro.titulo, subtitulo: livro.subtitulo, autor: livro.autor },
    dono: await tokenConfere(admin, id, req),
    // Capítulos ainda não aprovados: a tela mostra a aprovação (só para quem enviou).
    etapa: livro.capitulos ? "narracao" : "capitulos",
    narracao_comecou: !!livro.dados,
  });
}
