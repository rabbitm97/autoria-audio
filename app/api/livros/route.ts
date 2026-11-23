// POST /api/livros — recebe o .docx, título, subtítulo e autor; lê os
// capítulos, corta no limite da demonstração e cria o livro. Devolve o id e
// o token de quem enviou (guardado no navegador).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/adaptadores/supabase";
import { criarLivro, enviosRecentes, hashDoEndereco } from "@/lib/adaptadores/livros";
import { cortarNoLimite, lerDocx } from "@/lib/adaptadores/capitulos";
import { LIMITE_CARACTERES, LIMITE_ENVIOS_IP_DIA, TAMANHO_MAX_DOCX } from "@/lib/adaptadores/limites";
import { erro } from "@/lib/api/respostas";

export const maxDuration = 60;

function campo(form: FormData, nome: string, max: number): string {
  const v = form.get(nome);
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return erro(400, "Envio inválido.");
  }
  const arquivo = form.get("arquivo");
  const titulo = campo(form, "titulo", 120);
  const subtitulo = campo(form, "subtitulo", 160);
  const autor = campo(form, "autor", 120);
  if (!(arquivo instanceof File)) return erro(400, "Escolha o arquivo .docx do livro.");
  if (!/\.docx$/i.test(arquivo.name)) return erro(400, "O arquivo precisa ser .docx (Word).");
  if (arquivo.size > TAMANHO_MAX_DOCX) return erro(400, "O arquivo passa de 4 MB. Envie só os primeiros capítulos.");
  if (!titulo) return erro(400, "Informe o título do livro.");
  if (!autor) return erro(400, "Informe o nome de quem escreveu.");

  const admin = supabaseAdmin();
  const ipHash = hashDoEndereco(req);
  if ((await enviosRecentes(admin, ipHash)) >= LIMITE_ENVIOS_IP_DIA) {
    return erro(429, "Muitos envios deste endereço hoje. Tente de novo amanhã.");
  }

  let leitura;
  try {
    leitura = await lerDocx(Buffer.from(await arquivo.arrayBuffer()));
  } catch (e) {
    console.error("[livros] leitura do docx:", e instanceof Error ? e.message : e);
    return erro(422, "Não consegui ler este arquivo. Confira se é um .docx do Word e tente de novo.");
  }
  if (leitura.capitulos.length === 0) return erro(422, "Não encontrei texto neste arquivo.");

  const { capitulos, cortado } = cortarNoLimite(leitura.capitulos, LIMITE_CARACTERES);
  if (capitulos.length === 0) return erro(422, "Não encontrei texto neste arquivo.");

  const criado = await criarLivro(admin, { titulo, subtitulo: subtitulo || null, autor, capitulos, cortado, ipHash });
  if (!criado) return erro(500, "Falha ao guardar o livro. Tente de novo.");
  return NextResponse.json({ ok: true, id: criado.id, token: criado.token, cortado, criterio: leitura.criterio });
}
