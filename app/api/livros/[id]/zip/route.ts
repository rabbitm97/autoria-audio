// POST /api/livros/[id]/zip — link de download do ZIP com um MP3 por capítulo.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/adaptadores/supabase";
import { lerLivro } from "@/lib/adaptadores/livros";
import { linkDoZip } from "@/lib/audiolivro/zip";
import { daFalha, erro } from "@/lib/api/respostas";

export const maxDuration = 60;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = supabaseAdmin();
  const livro = await lerLivro(admin, id);
  if (!livro?.dados) return erro(404, "Audiolivro não encontrado.");
  const r = await linkDoZip(admin, id, livro.titulo, livro.dados);
  if (!r.ok) return daFalha(r);
  return NextResponse.json(r);
}
