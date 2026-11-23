// lib/adaptadores/livros.ts
//
// Tabela livros da demonstração: criar, ler, conferir o token de quem enviou
// e contar o uso para os limites. Só servidor.
//
// Não há conta de usuário: quem envia o livro recebe um token (guardado no
// navegador) que permite gerar, refazer e editar. Quem só tem o link ouve.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CandidatoCapitulo, CapituloAprovado, CapituloTexto, DadosAudio, LivroRegistro, TituloWord } from "./tipos";
import type { EstadoArbitragem } from "./arbitragem";

const COLUNAS = "id, titulo, subtitulo, autor, capitulos, texto_hash, cortado, dados, exemplo, criado_em";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function md5(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

/** Endereço de quem chama, guardado só como hash (para os limites). */
export function hashDoEndereco(req: Request): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "desconhecido";
  return sha256(`autoria-audio|${ip}`).slice(0, 32);
}

export function textoDoLivro(capitulos: CapituloTexto[]): string {
  return capitulos.map((c) => `${c.titulo}\n${c.texto}`).join("\n\n");
}

/** Cria o livro (ainda sem capítulos) e devolve o token de quem enviou. */
export async function criarLivro(
  admin: SupabaseClient,
  args: { titulo: string; subtitulo: string | null; autor: string; formato: string; ipHash: string },
): Promise<{ id: string; token: string } | null> {
  const token = randomBytes(24).toString("base64url");
  const { data, error } = await admin
    .from("livros")
    .insert({
      titulo: args.titulo,
      subtitulo: args.subtitulo,
      autor: args.autor,
      formato: args.formato,
      declaracao_aceita_em: new Date().toISOString(),
      token_hash: sha256(token),
      ip_hash: args.ipHash,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[livros] criar:", error?.message);
    return null;
  }
  return { id: (data as { id: string }).id, token };
}

/** Proposta de capítulos guardada para o texto de um hash (evita refazer a IA). */
export interface PropostaGuardada {
  hash: string;
  candidatos: CandidatoCapitulo[];
  arbitragem: EstadoArbitragem;
  truncado: boolean;
}

export interface Manuscrito {
  formato: string | null;
  texto: string | null;
  titulos_word: TituloWord[] | null;
  capitulos_aprovados: CapituloAprovado[] | null;
  capitulos_aprovados_hash: string | null;
  incluir_abertura: boolean;
  proposta: PropostaGuardada | null;
}

type LinhaManuscrito = Omit<Manuscrito, "proposta" | "texto" | "titulos_word"> & {
  texto: string | null;
  titulos_word: TituloWord[] | null;
  candidatos: unknown;
  blocos: { t: string; x: string }[] | null;
};

export async function lerManuscrito(admin: SupabaseClient, id: string): Promise<Manuscrito | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await admin
    .from("livros")
    .select("formato, texto, titulos_word, capitulos_aprovados, capitulos_aprovados_hash, incluir_abertura, candidatos, blocos")
    .eq("id", id)
    .maybeSingle();
  if (error) console.error("[livros] ler manuscrito:", error.message);
  const l = data as LinhaManuscrito | null;
  if (!l) return null;
  // Livros lidos antes do texto editável: o texto vem dos blocos antigos.
  let texto = l.texto;
  let titulos = l.titulos_word;
  if (texto === null && Array.isArray(l.blocos)) {
    texto = l.blocos.map((b) => b.x).join("\n\n");
    titulos = l.blocos.filter((b) => b.t !== "p").map((b) => ({ texto: b.x, nivel: Number(b.t.slice(1)) || 1 }));
  }
  const c = l.candidatos as Partial<PropostaGuardada> | null;
  const proposta = c && typeof c.hash === "string" && Array.isArray(c.candidatos) ? (c as PropostaGuardada) : null;
  return {
    formato: l.formato, texto, titulos_word: titulos ?? [], capitulos_aprovados: l.capitulos_aprovados,
    capitulos_aprovados_hash: l.capitulos_aprovados_hash, incluir_abertura: l.incluir_abertura !== false, proposta,
  };
}

/** Texto lido do arquivo (a proposta e as decisões antigas deixam de valer). */
export async function gravarTextoLido(admin: SupabaseClient, id: string, texto: string, titulosWord: TituloWord[]): Promise<boolean> {
  const { error } = await admin
    .from("livros")
    .update({ texto, titulos_word: titulosWord, candidatos: null, capitulos_aprovados: null, capitulos_aprovados_hash: null })
    .eq("id", id);
  if (error) console.error("[livros] gravar texto lido:", error.message);
  return !error;
}

export async function gravarProposta(admin: SupabaseClient, id: string, proposta: PropostaGuardada): Promise<void> {
  const { error } = await admin.from("livros").update({ candidatos: proposta }).eq("id", id);
  if (error) console.error("[livros] gravar proposta:", error.message);
}

/** Texto editado pelo autor e as posições dos capítulos decididos, juntos. */
export async function gravarTextoEditado(
  admin: SupabaseClient, id: string, texto: string, aprovados: CapituloAprovado[] | null,
): Promise<boolean> {
  const { error } = await admin
    .from("livros")
    .update({
      texto,
      capitulos_aprovados: aprovados && aprovados.length ? aprovados : null,
      capitulos_aprovados_hash: aprovados && aprovados.length ? md5(texto) : null,
    })
    .eq("id", id);
  if (error) console.error("[livros] gravar texto editado:", error.message);
  return !error;
}

export async function apagarDecisoes(admin: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await admin.from("livros").update({ capitulos_aprovados: null, capitulos_aprovados_hash: null }).eq("id", id);
  if (error) console.error("[livros] apagar decisões:", error.message);
  return !error;
}

/** Aprovação: decisões do autor e os capítulos que vão ser narrados. */
export async function gravarAprovacao(
  admin: SupabaseClient,
  id: string,
  args: { texto: string; aprovados: CapituloAprovado[]; incluirAbertura: boolean; capitulos: CapituloTexto[]; cortado: boolean },
): Promise<boolean> {
  const { error } = await admin
    .from("livros")
    .update({
      texto: args.texto,
      capitulos_aprovados: args.aprovados,
      capitulos_aprovados_hash: md5(args.texto),
      incluir_abertura: args.incluirAbertura,
      capitulos: args.capitulos,
      cortado: args.cortado,
      texto_hash: md5(textoDoLivro(args.capitulos)),
      capitulos_aprovados_em: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) console.error("[livros] gravar aprovação:", error.message);
  return !error;
}

export async function lerLivro(admin: SupabaseClient, id: string): Promise<LivroRegistro | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await admin.from("livros").select(COLUNAS).eq("id", id).maybeSingle();
  if (error) console.error("[livros] ler:", error.message);
  return (data as LivroRegistro | null) ?? null;
}

/** Livro de exemplo da página inicial (o mais recente marcado), já narrado. */
export async function livroDeExemplo(admin: SupabaseClient): Promise<LivroRegistro | null> {
  const { data, error } = await admin
    .from("livros")
    .select(COLUNAS)
    .eq("exemplo", true)
    .not("dados", "is", null)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) console.error("[livros] exemplo:", error.message);
  return (data as LivroRegistro | null) ?? null;
}

/** O token enviado (cabeçalho x-livro-token) é o do livro? */
export async function tokenConfere(admin: SupabaseClient, id: string, req: Request): Promise<boolean> {
  const token = req.headers.get("x-livro-token");
  if (!token || !UUID.test(id)) return false;
  const { data } = await admin.from("livros").select("token_hash").eq("id", id).maybeSingle();
  const guardado = (data as { token_hash?: string } | null)?.token_hash;
  if (!guardado) return false;
  const a = Buffer.from(sha256(token));
  const b = Buffer.from(guardado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function lerDados(admin: SupabaseClient, id: string): Promise<DadosAudio | null> {
  const { data, error } = await admin.from("livros").select("dados").eq("id", id).maybeSingle();
  if (error) console.error("[livros] ler dados:", error.message);
  return ((data as { dados?: DadosAudio | null } | null)?.dados ?? null) as DadosAudio | null;
}

export async function gravarDados(admin: SupabaseClient, id: string, dados: DadosAudio, extra: Record<string, unknown> = {}): Promise<boolean> {
  const { error } = await admin.from("livros").update({ dados, ...extra }).eq("id", id);
  if (error) console.error("[livros] gravar dados:", error.message);
  return !error;
}

/** Quantos livros foram mandados narrar nas últimas 24 horas (todos e deste endereço). */
export async function narracoesRecentes(admin: SupabaseClient, ipHash: string): Promise<{ total: number; doEndereco: number }> {
  const desde = new Date(Date.now() - 86_400_000).toISOString();
  const [todos, meus] = await Promise.all([
    admin.from("livros").select("id", { count: "exact", head: true }).gte("preparado_em", desde).eq("exemplo", false),
    admin.from("livros").select("id", { count: "exact", head: true }).gte("preparado_em", desde).eq("ip_hash", ipHash),
  ]);
  return { total: todos.count ?? 0, doEndereco: meus.count ?? 0 };
}

/** Quantos .docx este endereço enviou nas últimas 24 horas. */
export async function enviosRecentes(admin: SupabaseClient, ipHash: string): Promise<number> {
  const desde = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await admin.from("livros").select("id", { count: "exact", head: true }).gte("criado_em", desde).eq("ip_hash", ipHash);
  return count ?? 0;
}
