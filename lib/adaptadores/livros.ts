// lib/adaptadores/livros.ts
//
// Tabela livros da demonstração: criar, ler, conferir o token de quem enviou
// e contar o uso para os limites. Só servidor.
//
// Não há conta de usuário: quem envia o livro recebe um token (guardado no
// navegador) que permite gerar, refazer e editar. Quem só tem o link ouve.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CapituloTexto, DadosAudio, LivroRegistro } from "./tipos";

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

export async function criarLivro(
  admin: SupabaseClient,
  args: { titulo: string; subtitulo: string | null; autor: string; capitulos: CapituloTexto[]; cortado: boolean; ipHash: string },
): Promise<{ id: string; token: string } | null> {
  const token = randomBytes(24).toString("base64url");
  const { data, error } = await admin
    .from("livros")
    .insert({
      titulo: args.titulo,
      subtitulo: args.subtitulo,
      autor: args.autor,
      capitulos: args.capitulos,
      texto_hash: md5(textoDoLivro(args.capitulos)),
      cortado: args.cortado,
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

export async function lerLivro(admin: SupabaseClient, id: string): Promise<LivroRegistro | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await admin.from("livros").select(COLUNAS).eq("id", id).maybeSingle();
  if (error) console.error("[livros] ler:", error.message);
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
