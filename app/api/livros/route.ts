// POST /api/livros — { titulo, subtitulo?, autor, declaracao, arquivo: { nome, tamanho } }
// Cria o livro e devolve o id, o token de quem enviou (guardado no navegador)
// e um link para enviar o arquivo direto ao armazenamento (até 50 MB). Em
// seguida a tela chama /api/livros/[id]/manuscrito para ler o texto.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { BUCKET_MANUSCRITOS, supabaseAdmin } from "@/lib/adaptadores/supabase";
import { criarLivro, enviosRecentes, hashDoEndereco } from "@/lib/adaptadores/livros";
import { formatoDoNome } from "@/lib/adaptadores/manuscrito";
import { LIMITE_ENVIOS_IP_DIA, TAMANHO_MAX_MANUSCRITO } from "@/lib/adaptadores/limites";
import { erro } from "@/lib/api/respostas";

function texto(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return erro(400, "Envio inválido.");
  const titulo = texto(body.titulo, 120);
  const subtitulo = texto(body.subtitulo, 160);
  const autor = texto(body.autor, 120);
  const arquivo = (body.arquivo ?? {}) as { nome?: unknown; tamanho?: unknown };
  const nome = typeof arquivo.nome === "string" ? arquivo.nome : "";
  const tamanho = typeof arquivo.tamanho === "number" ? arquivo.tamanho : 0;
  const formato = formatoDoNome(nome);

  if (!titulo) return erro(400, "Informe o título do livro.");
  if (!autor) return erro(400, "Informe o nome de quem escreveu.");
  if (body.declaracao !== true) return erro(400, "Aceite a declaração de titularidade para continuar.");
  if (!formato) return erro(400, "Envie o manuscrito em .docx, .pdf ou .txt.");
  if (tamanho <= 0 || tamanho > TAMANHO_MAX_MANUSCRITO) return erro(400, "O arquivo precisa ter até 50 MB.");

  const admin = supabaseAdmin();
  const ipHash = hashDoEndereco(req);
  if ((await enviosRecentes(admin, ipHash)) >= LIMITE_ENVIOS_IP_DIA) {
    return erro(429, "Muitos envios deste endereço hoje. Tente de novo amanhã.");
  }

  const criado = await criarLivro(admin, { titulo, subtitulo: subtitulo || null, autor, formato, ipHash });
  if (!criado) return erro(500, "Falha ao registrar o livro. Tente de novo.");

  const caminho = `${criado.id}/original.${formato}`;
  const { data, error } = await admin.storage.from(BUCKET_MANUSCRITOS).createSignedUploadUrl(caminho);
  if (error || !data) {
    console.error("[livros] link de envio:", error?.message);
    return erro(500, "Falha ao preparar o envio. Tente de novo.");
  }
  return NextResponse.json({ ok: true, id: criado.id, token: criado.token, envio: data.signedUrl });
}
