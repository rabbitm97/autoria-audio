// lib/adaptadores/avisos.ts
//
// Créditos de narração da demonstração. Quando o serviço de voz responde que
// a cota do dia ou o orçamento acabou, a demonstração guarda o aviso por
// algumas horas: a tela avisa o visitante antes de ele tentar narrar, novas
// narrações não começam e a narração em andamento pausa sem gastar tentativa.

import type { SupabaseClient } from "@supabase/supabase-js";

const CHAVE = "creditos_voz";
const PAUSA_MS = 3 * 60 * 60 * 1000;

export const MSG_SEM_CREDITOS =
  "Os créditos de narração da demonstração acabaram por enquanto. Você pode enviar o livro e aprovar os capítulos; quando os créditos forem renovados, a narração continua de onde parou.";

export async function creditosEsgotados(admin: SupabaseClient): Promise<boolean> {
  const { data } = await admin.from("avisos_demo").select("ate").eq("id", CHAVE).maybeSingle();
  const ate = (data as { ate?: string } | null)?.ate;
  return !!ate && Date.parse(ate) > Date.now();
}

export async function marcarSemCreditos(admin: SupabaseClient, motivo: string): Promise<void> {
  const { error } = await admin
    .from("avisos_demo")
    .upsert({ id: CHAVE, ate: new Date(Date.now() + PAUSA_MS).toISOString(), motivo: motivo.slice(0, 200), atualizado_em: new Date().toISOString() });
  if (error) console.error("[avisos] marcar sem créditos:", error.message);
}
