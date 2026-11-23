// GET /api/vozes/[voz] — link da amostra de uma voz (gerada uma vez e guardada).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/adaptadores/supabase";
import { amostraDaVoz } from "@/lib/audiolivro/motor";
import { daFalha } from "@/lib/api/respostas";

export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ voz: string }> }) {
  const { voz } = await params;
  const r = await amostraDaVoz(supabaseAdmin(), voz);
  if (!r.ok) return daFalha(r);
  return NextResponse.json(r);
}
