// GET  /api/livros/[id]/capitulos — capítulos propostos (para aprovar).
// POST /api/livros/[id]/capitulos — { aprovados: [{ pos, titulo }], incluir_abertura }
// Monta os capítulos aprovados, corta no limite da demonstração e libera a
// narração. Só quem enviou (token), e só antes de a narração começar.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/adaptadores/supabase";
import { gravarCapitulos, lerLivro, lerManuscrito, tokenConfere } from "@/lib/adaptadores/livros";
import { cortarNoLimite, montarCapitulos } from "@/lib/adaptadores/capitulos";
import { LIMITE_CARACTERES } from "@/lib/adaptadores/limites";
import { erro } from "@/lib/api/respostas";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = supabaseAdmin();
  if (!(await tokenConfere(admin, id, req))) return erro(403, "Só quem enviou o livro pode aprovar os capítulos.");
  const m = await lerManuscrito(admin, id);
  if (!m?.candidatos) return erro(404, "O texto deste livro ainda não foi lido.");
  return NextResponse.json({ candidatos: m.candidatos.lista, abertura: m.candidatos.abertura, limite_caracteres: LIMITE_CARACTERES });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = supabaseAdmin();
  if (!(await tokenConfere(admin, id, req))) return erro(403, "Só quem enviou o livro pode aprovar os capítulos.");
  const livro = await lerLivro(admin, id);
  const m = await lerManuscrito(admin, id);
  if (!livro || !m?.blocos) return erro(404, "O texto deste livro ainda não foi lido.");
  if (livro.dados) return erro(409, "A narração já começou: os capítulos não mudam mais.");

  const body = (await req.json().catch(() => ({}))) as { aprovados?: unknown; incluir_abertura?: unknown };
  const aprovados = Array.isArray(body.aprovados)
    ? body.aprovados
        .map((a) => a as { pos?: unknown; titulo?: unknown })
        .filter((a) => typeof a.pos === "number")
        .map((a) => ({ pos: a.pos as number, titulo: typeof a.titulo === "string" ? a.titulo : "" }))
        .slice(0, 400)
    : [];
  const capitulos = montarCapitulos(m.blocos, aprovados, body.incluir_abertura === true, livro.titulo);
  if (!capitulos.some((c) => c.texto)) return erro(422, "Os capítulos marcados não têm texto.");
  const { capitulos: dentro, cortado } = cortarNoLimite(capitulos, LIMITE_CARACTERES);
  if (!(await gravarCapitulos(admin, id, dentro, cortado))) return erro(500, "Falha ao guardar os capítulos.");
  return NextResponse.json({ ok: true, capitulos: dentro.length, cortado });
}
