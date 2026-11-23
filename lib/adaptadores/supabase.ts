// lib/adaptadores/supabase.ts
//
// Cliente do Supabase da demonstração, só no servidor. Usa a chave secreta
// (acesso total): nunca importar em componente de tela. As tabelas não têm
// acesso pela chave pública (ver supabase/schema.sql).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cliente: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cliente) return cliente;
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SECRET_KEY;
  if (!url || !chave) throw new Error("SUPABASE_URL ou SUPABASE_SECRET_KEY não configurada.");
  cliente = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
  return cliente;
}

export const BUCKET = "audiolivros";
