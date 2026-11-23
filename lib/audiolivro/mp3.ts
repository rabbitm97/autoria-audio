// lib/audiolivro/mp3.ts
//
// D60-A. Codificação MP3 em JavaScript puro (sem ffmpeg no servidor).
// Saída: MP3 mono, 44,1 kHz, 192 kbps CBR. D60-B2: era 128 (mínimo do Google
// Play para mono); o Spotify for Authors e a ACX pedem 192 ou mais. CBR sem
// cabeçalho Xing: arquivos de trechos podem ser emendados byte a byte para
// formar o capítulo.

import { Mp3Encoder } from "@breezystack/lamejs";
import { TAXA_SAIDA } from "./pcm";

export const MP3_KBPS = 192;

export function codificarMp3(pcm: Int16Array, taxa: number = TAXA_SAIDA, kbps: number = MP3_KBPS): Uint8Array {
  const enc = new Mp3Encoder(1, taxa, kbps);
  const partes: Uint8Array[] = [];
  const bloco = 1152 * 20;
  for (let i = 0; i < pcm.length; i += bloco) {
    const p = enc.encodeBuffer(pcm.subarray(i, i + bloco));
    if (p.length) partes.push(new Uint8Array(p));
  }
  const fim = enc.flush();
  if (fim.length) partes.push(new Uint8Array(fim));
  return juntarBytes(partes);
}

export function juntarBytes(partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) { out.set(p, pos); pos += p.length; }
  return out;
}

/** Duração de um MP3 CBR pelo tamanho (sem decodificar). */
export function duracaoMp3Ms(bytes: number, kbps: number = MP3_KBPS): number {
  return Math.round((bytes * 8) / kbps);
}
