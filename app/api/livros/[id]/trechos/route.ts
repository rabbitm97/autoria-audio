// GET /api/livros/[id]/trechos?capitulo=n — trechos de um capítulo (texto
// falado, avisos e link de cada um). Sem capitulo: só os que pedem conferência.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/adaptadores/supabase";
import { UUID } from "@/lib/adaptadores/livros";
import { listarTrechos } from "@/lib/audiolivro/motor";
import { erro } from "@/lib/api/respostas";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return erro(404, "Livro não encontrado.");
  const c = req.nextUrl.searchParams.get("capitulo");
  const capitulo = c !== null && /^-?\d+$/.test(c) ? Number(c) : null;
  const trechos = await listarTrechos(supabaseAdmin(), id, capitulo);
  return NextResponse.json({ trechos });
}
