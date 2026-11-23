// POST /api/livros/[id]/processar — gera o próximo lote de trechos e monta
// os capítulos completos. A tela aberta chama em seguida até terminar.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/adaptadores/supabase";
import { tokenConfere } from "@/lib/adaptadores/livros";
import { processarLote } from "@/lib/audiolivro/motor";
import { daFalha, erro } from "@/lib/api/respostas";

export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = supabaseAdmin();
  if (!(await tokenConfere(admin, id, req))) return erro(403, "Só quem enviou o livro pode narrar.");
  const r = await processarLote(admin, id);
  if (!r.ok) return daFalha(r);
  return NextResponse.json(r);
}
