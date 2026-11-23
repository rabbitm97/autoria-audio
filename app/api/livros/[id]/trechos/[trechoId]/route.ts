// POST /api/livros/[id]/trechos/[trechoId] — { acao: "refazer" | "editar" |
// "restaurar", texto? } — o autor refaz um trecho ou ajusta o texto falado.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/adaptadores/supabase";
import { tokenConfere, UUID } from "@/lib/adaptadores/livros";
import { editarFala, pedirRegeneracao } from "@/lib/audiolivro/motor";
import { daFalha, erro } from "@/lib/api/respostas";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; trechoId: string }> }) {
  const { id, trechoId } = await params;
  if (!UUID.test(trechoId)) return erro(404, "Trecho não encontrado.");
  const admin = supabaseAdmin();
  if (!(await tokenConfere(admin, id, req))) return erro(403, "Só quem enviou o livro pode mudar a narração.");
  const body = (await req.json().catch(() => ({}))) as { acao?: unknown; texto?: unknown };
  const r =
    body.acao === "refazer"
      ? await pedirRegeneracao(admin, id, trechoId)
      : body.acao === "editar" || body.acao === "restaurar"
        ? await editarFala(admin, id, trechoId, body.texto, body.acao === "restaurar")
        : null;
  if (!r) return erro(400, "Ação inválida.");
  if (!r.ok) return daFalha(r);
  return NextResponse.json(r);
}
