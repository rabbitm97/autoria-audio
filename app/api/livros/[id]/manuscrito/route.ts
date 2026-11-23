// POST /api/livros/[id]/manuscrito — lê o arquivo enviado (.docx, .pdf ou
// .txt), guarda o texto (um parágrafo por linha) e os títulos do Word, e
// apaga o arquivo. A proposta de capítulos sai em GET /capitulos.
// Só quem enviou (token).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { BUCKET_MANUSCRITOS, supabaseAdmin } from "@/lib/adaptadores/supabase";
import { gravarTextoLido, lerLivro, lerManuscrito, tokenConfere } from "@/lib/adaptadores/livros";
import { lerArquivoDoManuscrito, type FormatoManuscrito } from "@/lib/adaptadores/manuscrito";
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

  let lido;
  try {
    lido = await lerArquivoDoManuscrito(new Uint8Array(await arquivo.arrayBuffer()), manuscrito.formato as FormatoManuscrito);
  } catch (e) {
    console.error("[manuscrito] leitura:", e instanceof Error ? e.message : e);
    return erro(422, "Falha ao extrair o texto do arquivo. Confira se ele abre normalmente e tente de novo.");
  }
  await admin.storage.from(BUCKET_MANUSCRITOS).remove([caminho]);
  if (lido.texto.trim().length < 50) {
    return erro(422, "O arquivo parece estar vazio ou sem texto extraível. Se for um PDF escaneado (imagem), envie o .docx.");
  }
  if (!(await gravarTextoLido(admin, id, lido.texto, lido.titulosWord))) return erro(500, "Falha ao guardar o texto.");
  return NextResponse.json({ ok: true, caracteres: lido.texto.length });
}
