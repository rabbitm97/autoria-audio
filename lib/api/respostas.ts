// lib/api/respostas.ts
// Respostas padrão das rotas.

import { NextResponse } from "next/server";
import type { Falha } from "@/lib/audiolivro/motor";

export function erro(status: number, mensagem: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: mensagem, ...extra }, { status });
}

export function daFalha(f: Falha) {
  return NextResponse.json(f.corpo, { status: f.status });
}
