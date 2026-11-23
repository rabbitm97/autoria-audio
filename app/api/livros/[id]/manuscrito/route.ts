// POST /api/livros/[id]/manuscrito — lê o arquivo enviado (.docx, .pdf ou
// .txt), separa em blocos, propõe os capítulos e apaga o arquivo. Só quem
// enviou (token).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { BUCKET_MANUSCRITOS, supabaseAdmin } from "@/lib/adaptadores/supabase";
import { gravarManuscrito, lerLivro, lerManuscrito, tokenConfere } from "@/lib/adaptadores/livros";
import { blocosDoManuscrito, type FormatoManuscrito } from "@/lib/adaptadores/manuscrito";
import { proporCandidatos } from "@/lib/adaptadores/capitulos";
import { erro } from "@/lib/api/respostas";

export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = supabaseAdmin();
  if (!(await tokenConfere(admin, id, req))) return erro(403, "Só quem enviou o livro pode continuar.");
  const livro = await lerLivro(admin, id);
  const manuscrito = await lerManuscrito(admin, id);
  if (!livro || !manuscrito?.formato) return erro(404, "Livro não encontrado.");
  if (livro.capitulos) return erro(409, "Os capítulos deste livro já foram aprovados.");

  const caminho = `${id}/original.${manuscrito.formato}`;
  const { data: arquivo, error } = await admin.storage.from(BUCKET_MANUSCRITOS).download(caminho);
  if (error || !arquivo) return erro(404, "O arquivo não chegou. Envie de novo.");

  let blocos;
  try {
    blocos = await blocosDoManuscrito(new Uint8Array(await arquivo.arrayBuffer()), manuscrito.formato as FormatoManuscrito);
  } catch (e) {
    console.error("[manuscrito] leitura:", e instanceof Error ? e.message : e);
    return erro(422, "Não foi possível ler este arquivo. Confira se ele abre normalmente e tente de novo.");
  }
  await admin.storage.from(BUCKET_MANUSCRITOS).remove([caminho]);
  if (!blocos.some((b) => b.t === "p")) {
    return erro(422, "Não encontrei texto neste arquivo. Se for um PDF escaneado (imagem), envie o .docx.");
  }

  const { candidatos, abertura } = proporCandidatos(blocos, livro.titulo);
  if (!(await gravarManuscrito(admin, id, blocos, candidatos, abertura))) return erro(500, "Falha ao guardar o texto.");
  return NextResponse.json({ ok: true, candidatos, abertura });
}
