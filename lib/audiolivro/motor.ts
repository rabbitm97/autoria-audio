// lib/audiolivro/motor.ts
//
// Motor do audiolivro (só servidor). Adaptado do motor da Autoria
// (ver PROVENIENCIA.md) para a demonstração: o livro vem da tabela livros
// (enviado como .docx), os trechos ficam na tabela trechos e os arquivos no
// bucket "audiolivros", na pasta do livro. Sem conta de usuário, cobrança,
// e-mail nem prazo de guarda; refazer e editar trechos têm um limite por livro.
//
// Operações idempotentes, chamadas pela tela aberta quantas vezes for:
//   prepararAudiolivro: texto do livro → trechos (o mesmo hash não é refeito).
//   processarLote: reserva até AUDIO_CONCORRENCIA trechos pendentes, gera a
//     voz, confere (duração e transcrição), refaz o que sai do padrão, grava o
//     MP3 e monta os capítulos que ficaram completos.
//   pedirRegeneracao / editarFala: o autor refaz um trecho ou ajusta o texto
//     que a voz fala.
// O que é narrado, na ordem em que toca: créditos iniciais, capítulos e
// créditos finais (índices -1 e -2 para os créditos).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUDIO_CARACTERES_POR_SEGUNDO,
  AUDIO_CONCORRENCIA,
  AUDIO_DURACAO_FOLGA_MS,
  AUDIO_DURACAO_MAX,
  AUDIO_DURACAO_MIN,
  AUDIO_ESTILO_INSTRUCAO,
  AUDIO_MAX_TENTATIVAS,
  AUDIO_PAUSA_ENTRE_TRECHOS_MS,
  AUDIO_PAUSA_FIM_MS,
  AUDIO_PAUSA_INICIO_MS,
  AUDIO_VERSAO_MOTOR,
  AUDIO_VOZES,
  isVozAudio,
} from "./config";
import { dividirEmTrechos, tituloFalado } from "./dividir";
import { normalizarParaFala } from "./normalizar";
import { analisar, aparar, masterizar, nivelar, reamostrar, silencio, wavDePcm, TAXA_SAIDA } from "./pcm";
import { codificarMp3, duracaoMp3Ms, juntarBytes } from "./mp3";
import { ErroTts, sintetizar, transcrever } from "./gemini";
import { conferirTranscricao } from "./conferir";
import { fraseComNome } from "./candidatos";
import {
  CREDITOS_FINAIS,
  CREDITOS_INICIAIS,
  TITULO_CREDITOS_FINAIS,
  TITULO_CREDITOS_INICIAIS,
  nomeArquivoTrecho,
  nomesDosArquivos,
  textoCreditos,
} from "./nomes";
import { BUCKET } from "@/lib/adaptadores/supabase";
import { gravarDados, lerDados, md5 } from "@/lib/adaptadores/livros";
import { LIMITE_REGENERACOES } from "@/lib/adaptadores/limites";
import { creditosEsgotados, marcarSemCreditos } from "@/lib/adaptadores/avisos";
import type { CapituloAudio, CapituloTexto, DadosAudio, LivroRegistro, Pronuncia } from "@/lib/adaptadores/tipos";

const TABELA = "trechos";

export const AUDIO_ESTILO_VERSAO = md5(AUDIO_ESTILO_INSTRUCAO).slice(0, 8);

export type Falha = { ok: false; status: number; corpo: Record<string, unknown> };

function pad(n: number, w: number): string {
  return String(n).padStart(w, "0");
}

/** Parte do caminho no bucket: "002" para capítulos, "k1"/"k2" para os créditos. */
function rotulo(index: number): string {
  return index < 0 ? `k${-index}` : pad(index, 3);
}

// ─── Texto do livro ─────────────────────────────────────────────────────────

export interface LivroParaAudio {
  capitulos: CapituloTexto[];
  textoHash: string;
  creditos: { inicio: string; fim: string };
}

/** Livro com os capítulos aprovados → o que o motor narra. */
export function livroParaAudio(livro: LivroRegistro): LivroParaAudio {
  return {
    capitulos: livro.capitulos ?? [],
    textoHash: livro.texto_hash ?? "",
    creditos: textoCreditos(livro.titulo, livro.subtitulo ?? "", livro.autor),
  };
}

export interface SegmentoAudio {
  index: number;
  titulo: string;
  texto: string;
  falarTitulo: boolean;
}

/** Na ordem em que toca. Nos créditos o título não é falado (é só o nome do arquivo). */
export function segmentosDoLivro(livro: LivroParaAudio): SegmentoAudio[] {
  return [
    { index: CREDITOS_INICIAIS, titulo: TITULO_CREDITOS_INICIAIS, texto: livro.creditos.inicio, falarTitulo: false },
    ...livro.capitulos.map((c, i) => ({ index: i, titulo: c.titulo, texto: c.texto, falarTitulo: true })),
    { index: CREDITOS_FINAIS, titulo: TITULO_CREDITOS_FINAIS, texto: livro.creditos.fim, falarTitulo: false },
  ];
}

export interface CapituloPrevia {
  index: number;
  titulo: string;
  caracteres: number;
  trechos: number;
}

/** Como o livro vai ficar no audiolivro, antes de preparar (nada é gravado). */
export function previaDoLivro(livro: LivroParaAudio): { capitulos: CapituloPrevia[]; caracteres: number } {
  const capitulos = segmentosDoLivro(livro).map((seg) => {
    const trechos = dividirEmTrechos(seg.texto).length; // 0 = sem texto, não narrado
    return { index: seg.index, titulo: seg.titulo, caracteres: trechos > 0 ? seg.texto.length : 0, trechos };
  });
  return { capitulos, caracteres: capitulos.reduce((s, c) => s + c.caracteres, 0) };
}

// ─── Preparação ─────────────────────────────────────────────────────────────

interface TrechoPlanejado {
  capitulo: number;
  ordem: number;
  texto: string;
  texto_fala: string;
  hash: string;
}

function hashDoTrecho(voz: string, textoFala: string): string {
  return md5(`${AUDIO_VERSAO_MOTOR}|${AUDIO_ESTILO_VERSAO}|${voz}|${textoFala}`);
}

export function limparPronuncias(lista: unknown): Pronuncia[] {
  if (!Array.isArray(lista)) return [];
  return lista
    .map((p) => p as { grafia?: unknown; fala?: unknown })
    .filter((p) => typeof p.grafia === "string" && typeof p.fala === "string")
    .map((p) => ({ grafia: (p.grafia as string).trim().slice(0, 80), fala: (p.fala as string).trim().slice(0, 80) }))
    .filter((p) => p.grafia && p.fala)
    .slice(0, 100);
}

export function planejarTrechos(segmentos: SegmentoAudio[], voz: string, pronuncias: Pronuncia[]): TrechoPlanejado[] {
  const plano: TrechoPlanejado[] = [];
  for (const seg of segmentos) {
    // Capítulo sem texto (só o título) não é narrado: com tão pouco texto a
    // voz inventa continuação, e um capítulo nunca é emendado em outro.
    const pedacos = dividirEmTrechos(seg.texto);
    if (pedacos.length === 0) continue;
    const titulo = seg.falarTitulo ? tituloFalado(seg.titulo) : "";
    if (titulo) pedacos[0] = `${titulo}\n\n${pedacos[0]}`;
    pedacos.forEach((texto, oi) => {
      const texto_fala = normalizarParaFala(texto, pronuncias);
      plano.push({ capitulo: seg.index, ordem: oi, texto, texto_fala, hash: hashDoTrecho(voz, texto_fala) });
    });
  }
  return plano;
}

interface TrechoExistente {
  id: string;
  capitulo: number;
  ordem: number;
  hash: string;
  storage_path: string | null;
  texto_fala: string;
  texto_fala_original: string | null;
}

/** O que uma preparação vai usar, mostrado ao autor para confirmar. */
export interface UsoPreparacao {
  regeneracoes: number;
}

export async function prepararAudiolivro(
  admin: SupabaseClient,
  args: {
    livroId: string;
    livro: LivroParaAudio;
    voz: unknown;
    pronuncias: unknown;
    atual: DadosAudio | null;
    /** O uso que o autor viu e confirmou (devolvido no 409). */
    confirmar?: unknown;
    /** Etapa obrigatória de nomes e pronúncia feita (1ª narração). */
    nomesConferidos?: unknown;
  },
): Promise<{ ok: true; dados: DadosAudio; refazer: number; edicoesDescartadas: number } | Falha> {
  const { livroId, livro, atual } = args;
  if (!isVozAudio(args.voz)) return { ok: false, status: 400, corpo: { error: "Voz inválida." } };
  if (!atual && args.nomesConferidos !== true) {
    return { ok: false, status: 400, corpo: { error: "Confira os nomes e a pronúncia antes de gerar.", reason: "nomes_nao_conferidos" } };
  }
  const voz = args.voz;
  const pronuncias = limparPronuncias(args.pronuncias);

  const segmentos = segmentosDoLivro(livro);
  const plano = planejarTrechos(segmentos, voz, pronuncias);
  const caracteres = previaDoLivro(livro).caracteres;

  const { data: existentesRaw, error: errLeitura } = await admin
    .from(TABELA)
    .select("id, capitulo, ordem, hash, estado, storage_path, texto_fala, texto_fala_original")
    .eq("livro_id", livroId);
  if (errLeitura) return { ok: false, status: 500, corpo: { error: "Falha ao ler os trechos." } };
  const existentes = (existentesRaw ?? []) as (TrechoExistente & { estado: string })[];

  if (atual && atual.voz !== voz && existentes.some((t) => t.estado === "pronto")) {
    return { ok: false, status: 409, corpo: { error: "A voz não pode mudar depois que a narração começou.", reason: "voz_travada" } };
  }

  const porChave = new Map(existentes.map((t) => [`${t.capitulo}:${t.ordem}`, t]));
  const agora = new Date().toISOString();
  const gravar: Record<string, unknown>[] = [];
  const arquivosVelhos: string[] = [];
  const capitulosMudados = new Set<number>();
  // Trecho já narrado cujo texto falado mudou (pronúncia) gasta 1 regeneração.
  let refazerNarrados = 0;
  let edicoesDescartadas = 0;

  for (const p of plano) {
    const ex = porChave.get(`${p.capitulo}:${p.ordem}`);
    porChave.delete(`${p.capitulo}:${p.ordem}`);
    // Fala editada pelo autor continua valendo enquanto o texto original do
    // trecho não muda; se mudou, a edição sai e o trecho segue o texto novo.
    let textoFala = p.texto_fala;
    let hash = p.hash;
    let original: string | null = null;
    if (ex?.texto_fala_original) {
      if (ex.texto_fala_original === p.texto_fala) {
        textoFala = ex.texto_fala;
        hash = hashDoTrecho(voz, textoFala);
        original = ex.texto_fala_original;
      } else {
        edicoesDescartadas++;
      }
    }
    if (ex && ex.hash === hash) continue;
    if (ex?.estado === "pronto" && ex.texto_fala !== textoFala) refazerNarrados++;
    capitulosMudados.add(p.capitulo);
    if (ex?.storage_path) arquivosVelhos.push(ex.storage_path);
    gravar.push({
      livro_id: livroId,
      capitulo: p.capitulo,
      ordem: p.ordem,
      texto: p.texto,
      texto_fala: textoFala,
      texto_fala_original: original,
      hash,
      estado: "pendente",
      tentativas: 0,
      reservado_ate: null,
      storage_path: null,
      duracao_ms: null,
      avisos: [],
      erro: null,
      pedido_pelo_autor: false,
      conferencia: null,
      atualizado_em: agora,
    });
  }
  const sobras = [...porChave.values()];
  for (const s of sobras) {
    capitulosMudados.add(s.capitulo);
    if (s.storage_path) arquivosVelhos.push(s.storage_path);
  }

  // Antes de gravar: confere a cota e pede a confirmação do autor (409 com o uso).
  const restantes = Math.max(0, LIMITE_REGENERACOES - (atual?.regeneracoes_usadas ?? 0));
  if (refazerNarrados > restantes) {
    return {
      ok: false,
      status: 402,
      corpo: {
        error: `Esta mudança refaz ${refazerNarrados} trechos já narrados e restam ${restantes} regenerações neste livro.`,
        reason: "sem_regeneracoes",
        regeneracoes: refazerNarrados,
        restantes,
      },
    };
  }
  const uso: UsoPreparacao = { regeneracoes: refazerNarrados };
  const confirmado = (args.confirmar as UsoPreparacao | undefined)?.regeneracoes === uso.regeneracoes;
  if (uso.regeneracoes > 0 && !confirmado) {
    return {
      ok: false,
      status: 409,
      corpo: { error: "Confirme o que esta ação vai usar.", reason: "confirmar", uso, regeneracoes_restantes: restantes, edicoes_descartadas: edicoesDescartadas },
    };
  }

  for (let i = 0; i < gravar.length; i += 200) {
    const { error } = await admin.from(TABELA).upsert(gravar.slice(i, i + 200), { onConflict: "livro_id,capitulo,ordem" });
    if (error) {
      console.error("[audiolivro] gravar trechos:", error.message);
      return { ok: false, status: 500, corpo: { error: "Falha ao gravar os trechos." } };
    }
  }
  if (sobras.length) {
    const { error } = await admin.from(TABELA).delete().in("id", sobras.map((s) => s.id));
    if (error) console.error("[audiolivro] remover trechos que saíram do livro:", error.message);
  }
  if (arquivosVelhos.length) {
    const { error } = await admin.storage.from(BUCKET).remove(arquivosVelhos);
    if (error) console.error("[audiolivro] remover arquivos velhos:", error.message);
  }

  const capitulos: CapituloAudio[] = segmentos.map((seg) => {
    const anterior = atual?.capitulos.find((c) => c.index === seg.index) ?? null;
    const mudou = capitulosMudados.has(seg.index) || !anterior;
    return {
      index: seg.index,
      titulo: seg.titulo,
      trechos: plano.filter((p) => p.capitulo === seg.index).length,
      caracteres: seg.texto.length,
      storage_path: anterior?.storage_path ?? null,
      duracao_ms: mudou ? null : anterior?.duracao_ms ?? null,
      montado_em: mudou ? null : anterior?.montado_em ?? null,
    };
  });

  const dados: DadosAudio = {
    voz,
    estilo_versao: AUDIO_ESTILO_VERSAO,
    pronuncias,
    texto_hash: livro.textoHash,
    caracteres,
    regeneracoes_usadas: (atual?.regeneracoes_usadas ?? 0) + refazerNarrados,
    capitulos,
    preparado_em: agora,
  };
  if (!(await gravarDados(admin, livroId, dados, { preparado_em: agora }))) {
    return { ok: false, status: 500, corpo: { error: "Falha ao registrar o audiolivro." } };
  }
  return { ok: true, dados, refazer: gravar.length, edicoesDescartadas };
}

// ─── Processamento ──────────────────────────────────────────────────────────

interface TrechoReservado {
  id: string;
  livro_id: string;
  capitulo: number;
  ordem: number;
  texto_fala: string;
  hash: string;
  tentativas: number;
}

type Desfecho = "pronto" | "repetir" | "falhou" | "limite" | "limite_diario";

async function gerarTrecho(admin: SupabaseClient, t: TrechoReservado, voz: string): Promise<Desfecho> {
  const atualizar = async (campos: Record<string, unknown>) => {
    const { error } = await admin
      .from(TABELA)
      .update({ ...campos, reservado_ate: null, atualizado_em: new Date().toISOString() })
      .eq("id", t.id)
      .eq("hash", t.hash); // trecho reescrito pela preparação no meio do caminho: não pisa
    if (error) console.error(`[audiolivro] trecho ${t.capitulo}/${t.ordem}:`, error.message);
  };

  let r;
  try {
    r = await sintetizar(t.texto_fala, voz);
  } catch (e) {
    const err = e instanceof ErroTts ? e : new ErroTts(String(e), "temporario");
    console.warn(`[audiolivro] trecho ${t.capitulo}/${t.ordem} tentativa ${t.tentativas}: ${err.tipo} ${err.message}`);
    if (err.tipo === "limite") {
      // Cota estourada: devolve a tentativa e espera.
      await atualizar({ estado: "pendente", tentativas: Math.max(0, t.tentativas - 1), erro: err.diario ? "limite_diario" : "limite" });
      return err.diario ? "limite_diario" : "limite";
    }
    const desiste = err.tipo === "definitivo" || t.tentativas >= AUDIO_MAX_TENTATIVAS;
    await atualizar({ estado: desiste ? "falhou" : "pendente", erro: err.message.slice(0, 500) });
    return desiste ? "falhou" : "repetir";
  }

  const podeRefazer = t.tentativas < AUDIO_MAX_TENTATIVAS;
  // Nivela antes de aparar, para o limiar de silêncio valer igual em todo trecho.
  const aparado = aparar(nivelar(r.pcm).pcm, r.taxa);
  const medida = analisar(aparado, r.taxa);
  const esperadoMs = Math.round((t.texto_fala.length / AUDIO_CARACTERES_POR_SEGUNDO) * 1000);
  const avisos: string[] = [];

  // 1. Conferência barata: duração pelo ritmo medido e som estourado.
  if (medida.duracaoMs < esperadoMs * AUDIO_DURACAO_MIN - AUDIO_DURACAO_FOLGA_MS) avisos.push("curto_demais");
  if (medida.duracaoMs > esperadoMs * AUDIO_DURACAO_MAX + AUDIO_DURACAO_FOLGA_MS) avisos.push("longo_demais");
  if (medida.clipadas > 200) avisos.push("estourado");
  if (avisos.length && podeRefazer) {
    await atualizar({ estado: "pendente", avisos, erro: null, conferencia: { duracao_ms: medida.duracaoMs, esperado_ms: esperadoMs } });
    return "repetir";
  }

  // 2. Conferência por transcrição: o áudio diz o que o texto diz?
  let conferencia: Record<string, unknown>;
  try {
    const ouvido = await transcrever(wavDePcm(aparado, r.taxa));
    const c = conferirTranscricao(t.texto_fala, ouvido);
    conferencia = { ...c, duracao_ms: medida.duracaoMs, esperado_ms: esperadoMs, transcricao: ouvido.slice(0, 4000) };
    if (!c.ok) avisos.push("fala_diferente");
  } catch (e) {
    // Conferência fora do ar não descarta a voz já gerada: salva e avisa.
    const msg = e instanceof Error ? e.message : String(e);
    avisos.push("sem_conferencia");
    conferencia = { erro: msg.slice(0, 300), duracao_ms: medida.duracaoMs, esperado_ms: esperadoMs };
  }
  if (avisos.includes("fala_diferente") && podeRefazer) {
    await atualizar({ estado: "pendente", avisos, erro: null, conferencia });
    return "repetir";
  }

  // 3. Grava. Aviso que sobrou depois das tentativas fica para o autor conferir.
  // Créditos são arquivos curtos: um pouco mais de volume na fala mantém o
  // arquivo inteiro na faixa de volume pedida para audiolivros.
  const { pcm: masterizado } = masterizar(aparado, r.taxa, t.capitulo < 0 ? -18 : undefined);
  const mp3 = codificarMp3(reamostrar(masterizado, r.taxa, TAXA_SAIDA));
  const caminho = `${t.livro_id}/trechos/c${rotulo(t.capitulo)}-t${pad(t.ordem, 4)}-${t.hash.slice(0, 8)}.mp3`;
  const { error: errUp } = await admin.storage.from(BUCKET).upload(caminho, mp3, { contentType: "audio/mpeg", upsert: true });
  if (errUp) {
    const desiste = t.tentativas >= AUDIO_MAX_TENTATIVAS;
    await atualizar({ estado: desiste ? "falhou" : "pendente", erro: `upload: ${errUp.message}`.slice(0, 500) });
    return desiste ? "falhou" : "repetir";
  }
  await atualizar({ estado: "pronto", storage_path: caminho, duracao_ms: duracaoMp3Ms(mp3.length), avisos, erro: null, conferencia });
  return "pronto";
}

interface TrechoParaMontar {
  capitulo: number;
  ordem: number;
  estado: string;
  storage_path: string | null;
  duracao_ms: number | null;
  atualizado_em: string;
}

/** Monta (emenda) os capítulos completos que ainda não foram montados ou mudaram. */
async function montarCapitulos(admin: SupabaseClient, livroId: string, limite = 2): Promise<number> {
  const dados = await lerDados(admin, livroId);
  if (!dados) return 0;
  const { data, error } = await admin
    .from(TABELA)
    .select("capitulo, ordem, estado, storage_path, duracao_ms, atualizado_em")
    .eq("livro_id", livroId)
    .order("capitulo")
    .order("ordem");
  if (error) {
    console.error("[audiolivro] leitura para montagem:", error.message);
    return 0;
  }
  const porCap = new Map<number, TrechoParaMontar[]>();
  for (const t of (data ?? []) as TrechoParaMontar[]) {
    const l = porCap.get(t.capitulo) ?? [];
    l.push(t);
    porCap.set(t.capitulo, l);
  }

  const prontosParaMontar = dados.capitulos.filter((cap) => {
    if (cap.trechos === 0) return false;
    const ts = porCap.get(cap.index) ?? [];
    if (ts.length !== cap.trechos || !ts.every((t) => t.estado === "pronto" && t.storage_path)) return false;
    if (!cap.montado_em) return true;
    const montado = Date.parse(cap.montado_em);
    return ts.some((t) => Date.parse(t.atualizado_em) > montado);
  });

  const silInicio = codificarMp3(silencio(AUDIO_PAUSA_INICIO_MS, TAXA_SAIDA));
  const silMeio = codificarMp3(silencio(AUDIO_PAUSA_ENTRE_TRECHOS_MS, TAXA_SAIDA));
  const silFim = codificarMp3(silencio(AUDIO_PAUSA_FIM_MS, TAXA_SAIDA));
  const montados = new Map<number, { storage_path: string; duracao_ms: number; montado_em: string }>();

  for (const cap of prontosParaMontar.slice(0, limite)) {
    const ts = porCap.get(cap.index)!;
    const partes: Uint8Array[] = [silInicio];
    let falhou = false;
    for (let i = 0; i < ts.length; i++) {
      const { data: blob, error: errDown } = await admin.storage.from(BUCKET).download(ts[i].storage_path!);
      if (errDown || !blob) {
        console.error(`[audiolivro] download do trecho ${cap.index}/${ts[i].ordem}:`, errDown?.message);
        falhou = true;
        break;
      }
      if (i > 0) partes.push(silMeio);
      partes.push(new Uint8Array(await blob.arrayBuffer()));
    }
    if (falhou) continue;
    partes.push(silFim);
    const mp3 = juntarBytes(partes);
    const duracao =
      AUDIO_PAUSA_INICIO_MS + AUDIO_PAUSA_FIM_MS + AUDIO_PAUSA_ENTRE_TRECHOS_MS * (ts.length - 1) +
      ts.reduce((s, t) => s + (t.duracao_ms ?? 0), 0);
    const caminho = `${livroId}/capitulos/cap_${rotulo(cap.index)}.mp3`;
    const { error: errUp } = await admin.storage.from(BUCKET).upload(caminho, mp3, { contentType: "audio/mpeg", upsert: true });
    if (errUp) {
      console.error(`[audiolivro] upload do capítulo ${cap.index}:`, errUp.message);
      continue;
    }
    montados.set(cap.index, { storage_path: caminho, duracao_ms: duracao, montado_em: new Date().toISOString() });
  }
  if (montados.size === 0) return 0;

  // Relê antes de gravar: outra chamada pode ter mexido no meio do caminho.
  const fresco = await lerDados(admin, livroId);
  if (!fresco) return 0;
  fresco.capitulos = fresco.capitulos.map((c) => (montados.has(c.index) ? { ...c, ...montados.get(c.index)! } : c));
  await gravarDados(admin, livroId, fresco);
  return montados.size;
}

export interface StatusAudio {
  total: number;
  prontos: number;
  pendentes: number;
  gerando: number;
  falhos: number;
  com_aviso: number;
  capitulos: number;
  capitulos_montados: number;
  terminado: boolean;
}

export async function statusAudiolivro(admin: SupabaseClient, livroId: string, dados: DadosAudio | null): Promise<StatusAudio> {
  const { data } = await admin.from(TABELA).select("estado, avisos").eq("livro_id", livroId);
  const linhas = (data ?? []) as { estado: string; avisos: unknown }[];
  const conta = (e: string) => linhas.filter((l) => l.estado === e).length;
  const narrados = dados?.capitulos.filter((c) => c.trechos > 0) ?? [];
  const capitulos_montados = narrados.filter((c) => c.montado_em).length;
  const prontos = conta("pronto");
  return {
    total: linhas.length,
    prontos,
    pendentes: conta("pendente"),
    gerando: conta("gerando"),
    falhos: conta("falhou"),
    com_aviso: linhas.filter((l) => l.estado === "pronto" && Array.isArray(l.avisos) && l.avisos.length > 0).length,
    capitulos: narrados.length,
    capitulos_montados,
    terminado: linhas.length > 0 && prontos === linhas.length && capitulos_montados === narrados.length,
  };
}

export async function processarLote(
  admin: SupabaseClient,
  livroId: string,
): Promise<{ ok: true; status: StatusAudio; aguardar_ms: number; limite_diario: boolean } | Falha> {
  const dados = await lerDados(admin, livroId);
  if (!dados) return { ok: false, status: 409, corpo: { error: "Escolha a voz e comece a narração antes.", reason: "nao_preparado" } };

  // Créditos de voz da demonstração esgotados: pausa sem chamar o serviço.
  if (await creditosEsgotados(admin)) {
    return { ok: true, status: await statusAudiolivro(admin, livroId, dados), aguardar_ms: 0, limite_diario: true };
  }

  const { data: reservados, error } = await admin.rpc("reservar_trechos", {
    p_livro_id: livroId,
    p_limite: AUDIO_CONCORRENCIA,
    p_max_tentativas: AUDIO_MAX_TENTATIVAS,
  });
  if (error) {
    console.error("[audiolivro] reserva de trechos:", error.message);
    return { ok: false, status: 500, corpo: { error: "Falha ao reservar trechos." } };
  }

  const lote = (reservados ?? []) as TrechoReservado[];
  const desfechos = await Promise.all(lote.map((t) => gerarTrecho(admin, t, dados.voz)));
  await montarCapitulos(admin, livroId);

  const fresco = await lerDados(admin, livroId);
  const status = await statusAudiolivro(admin, livroId, fresco);
  const limiteDiario = desfechos.includes("limite_diario");
  if (limiteDiario) await marcarSemCreditos(admin, "limite do dia ou orçamento do serviço de voz");
  return {
    ok: true,
    status,
    aguardar_ms: desfechos.includes("limite") ? 20_000 : 0,
    limite_diario: limiteDiario,
  };
}

// ─── Refazer e editar trechos ───────────────────────────────────────────────

function semCota(dados: DadosAudio): boolean {
  return dados.regeneracoes_usadas >= LIMITE_REGENERACOES;
}

/** Trecho pronto refeito gasta 1 do limite; trecho que falhou é refeito sem gastar. */
export async function pedirRegeneracao(
  admin: SupabaseClient,
  livroId: string,
  trechoId: unknown,
): Promise<{ ok: true; regeneracoes_usadas: number } | Falha> {
  if (typeof trechoId !== "string" || !trechoId) return { ok: false, status: 400, corpo: { error: "Trecho inválido." } };
  const dados = await lerDados(admin, livroId);
  if (!dados) return { ok: false, status: 409, corpo: { error: "Comece a narração antes.", reason: "nao_preparado" } };

  const { data: atual } = await admin.from(TABELA).select("estado").eq("id", trechoId).eq("livro_id", livroId).maybeSingle();
  const estado = (atual as { estado?: string } | null)?.estado;
  if (estado !== "pronto" && estado !== "falhou") {
    return { ok: false, status: 409, corpo: { error: "Este trecho ainda está na fila.", reason: "trecho_ocupado" } };
  }
  const gastaCota = estado === "pronto";
  if (gastaCota && semCota(dados)) {
    return { ok: false, status: 402, corpo: { error: `Este livro já usou as ${LIMITE_REGENERACOES} regenerações da demonstração.`, reason: "sem_cota" } };
  }
  const { data: linha, error } = await admin
    .from(TABELA)
    .update({ estado: "pendente", tentativas: 0, pedido_pelo_autor: gastaCota, avisos: [], erro: null, reservado_ate: null, atualizado_em: new Date().toISOString() })
    .eq("id", trechoId)
    .eq("livro_id", livroId)
    .eq("estado", estado)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500, corpo: { error: "Falha ao pedir a regeneração." } };
  if (!linha) return { ok: false, status: 409, corpo: { error: "Este trecho ainda está na fila.", reason: "trecho_ocupado" } };
  if (!gastaCota) return { ok: true, regeneracoes_usadas: dados.regeneracoes_usadas };

  const fresco = (await lerDados(admin, livroId)) ?? dados;
  fresco.regeneracoes_usadas += 1;
  await gravarDados(admin, livroId, fresco);
  return { ok: true, regeneracoes_usadas: fresco.regeneracoes_usadas };
}

/** Edição é ajuste, não reescrita: mínimo de palavras mantidas e tamanho máximo. */
export const EDICAO_SEMELHANCA_MIN = 0.7;
export const EDICAO_CRESCIMENTO_MAX = 1.2;

/**
 * O autor troca o texto que a voz fala num trecho (ou restaura o original)
 * e o trecho volta para a fila. O texto do livro não muda:
 * texto_fala_original guarda o que o livro diz.
 */
export async function editarFala(
  admin: SupabaseClient,
  livroId: string,
  trechoId: unknown,
  textoPedido: unknown,
  restaurar: boolean,
): Promise<{ ok: true; regeneracoes_usadas: number } | Falha> {
  if (typeof trechoId !== "string" || !trechoId) return { ok: false, status: 400, corpo: { error: "Trecho inválido." } };
  const dados = await lerDados(admin, livroId);
  if (!dados) return { ok: false, status: 409, corpo: { error: "Comece a narração antes.", reason: "nao_preparado" } };

  const { data: linha } = await admin
    .from(TABELA)
    .select("id, estado, texto_fala, texto_fala_original, storage_path")
    .eq("id", trechoId)
    .eq("livro_id", livroId)
    .maybeSingle();
  const t = linha as { id: string; estado: string; texto_fala: string; texto_fala_original: string | null; storage_path: string | null } | null;
  if (!t) return { ok: false, status: 404, corpo: { error: "Trecho não encontrado." } };
  if (t.estado !== "pronto" && t.estado !== "falhou") {
    return { ok: false, status: 409, corpo: { error: "Este trecho ainda está na fila.", reason: "trecho_ocupado" } };
  }

  const base = t.texto_fala_original ?? t.texto_fala;
  let novo: string;
  if (restaurar) {
    if (!t.texto_fala_original) return { ok: false, status: 400, corpo: { error: "Este trecho não foi editado." } };
    novo = base;
  } else {
    const bruto = typeof textoPedido === "string" ? textoPedido.trim().slice(0, 4000) : "";
    if (!bruto) return { ok: false, status: 400, corpo: { error: "Escreva o texto do trecho." } };
    novo = normalizarParaFala(bruto, dados.pronuncias ?? []);
    if (novo === t.texto_fala) return { ok: false, status: 400, corpo: { error: "O texto não mudou." } };
    const c = conferirTranscricao(base, novo);
    if (c.semelhanca < EDICAO_SEMELHANCA_MIN || novo.length > base.length * EDICAO_CRESCIMENTO_MAX + 20) {
      return { ok: false, status: 400, corpo: { error: "Esta edição muda demais o trecho. Ajuste palavras, sem reescrever.", reason: "edicao_grande" } };
    }
  }

  const gastaCota = t.estado === "pronto";
  if (gastaCota && semCota(dados)) {
    return { ok: false, status: 402, corpo: { error: `Este livro já usou as ${LIMITE_REGENERACOES} regenerações da demonstração.`, reason: "sem_cota" } };
  }

  const { data: atualizada, error } = await admin
    .from(TABELA)
    .update({
      texto_fala: novo,
      texto_fala_original: restaurar ? null : base,
      hash: hashDoTrecho(dados.voz, novo),
      estado: "pendente",
      tentativas: 0,
      pedido_pelo_autor: gastaCota,
      avisos: [],
      erro: null,
      reservado_ate: null,
      storage_path: null,
      duracao_ms: null,
      conferencia: null,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", t.id)
    .eq("estado", t.estado)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500, corpo: { error: "Falha ao salvar a edição." } };
  if (!atualizada) return { ok: false, status: 409, corpo: { error: "Este trecho ainda está na fila.", reason: "trecho_ocupado" } };
  if (t.storage_path) await admin.storage.from(BUCKET).remove([t.storage_path]);

  if (!gastaCota) return { ok: true, regeneracoes_usadas: dados.regeneracoes_usadas };
  const fresco = (await lerDados(admin, livroId)) ?? dados;
  fresco.regeneracoes_usadas += 1;
  await gravarDados(admin, livroId, fresco);
  return { ok: true, regeneracoes_usadas: fresco.regeneracoes_usadas };
}

// ─── Trechos e links para a tela ────────────────────────────────────────────

export interface TrechoParaAutor {
  id: string;
  capitulo: number;
  capitulo_titulo: string;
  ordem: number;
  estado: string;
  inicio: string;
  texto_fala: string;
  editado: boolean;
  avisos: string[];
  duracao_ms: number | null;
  url: string | null;
}

/** Trechos de um capítulo, ou (capitulo null) só os que pedem conferência do autor. */
export async function listarTrechos(admin: SupabaseClient, livroId: string, capitulo: number | null): Promise<TrechoParaAutor[]> {
  let q = admin
    .from(TABELA)
    .select("id, capitulo, ordem, estado, texto, texto_fala, texto_fala_original, avisos, duracao_ms, storage_path")
    .eq("livro_id", livroId)
    .order("capitulo")
    .order("ordem");
  if (capitulo !== null) q = q.eq("capitulo", capitulo);
  const { data, error } = await q;
  if (error) {
    console.error("[audiolivro] listar trechos:", error.message);
    return [];
  }
  const linhas = (data ?? []) as {
    id: string; capitulo: number; ordem: number; estado: string; texto: string;
    texto_fala: string; texto_fala_original: string | null;
    avisos: unknown; duracao_ms: number | null; storage_path: string | null;
  }[];
  const filtradas = capitulo !== null
    ? linhas
    : linhas.filter((l) => l.estado === "falhou" || (Array.isArray(l.avisos) && l.avisos.length > 0));
  const dados = await lerDados(admin, livroId);
  const titulos = new Map((dados?.capitulos ?? []).map((c) => [c.index, c.titulo]));
  return Promise.all(
    filtradas.map(async (l) => {
      const capituloTitulo = titulos.get(l.capitulo) ?? "";
      let url: string | null = null;
      if (l.estado === "pronto" && l.storage_path) {
        const { data: s } = await admin.storage
          .from(BUCKET)
          .createSignedUrl(l.storage_path, 3600, { download: nomeArquivoTrecho(capituloTitulo, l.ordem) });
        url = s?.signedUrl ?? null;
      }
      return {
        id: l.id,
        capitulo: l.capitulo,
        capitulo_titulo: capituloTitulo,
        ordem: l.ordem,
        estado: l.estado,
        inicio: l.texto.replace(/\s+/g, " ").slice(0, 160),
        texto_fala: l.texto_fala,
        editado: !!l.texto_fala_original,
        avisos: Array.isArray(l.avisos) ? (l.avisos as string[]) : [],
        duracao_ms: l.duracao_ms,
        url,
      };
    }),
  );
}

/** Link (1h) de cada capítulo montado, para tocar na tela. */
export async function linksDosCapitulos(admin: SupabaseClient, dados: DadosAudio): Promise<Record<number, string>> {
  const links: Record<number, string> = {};
  await Promise.all(
    dados.capitulos
      .filter((c) => c.montado_em && c.storage_path)
      .map(async (c) => {
        const { data } = await admin.storage.from(BUCKET).createSignedUrl(c.storage_path!, 3600);
        if (data?.signedUrl) links[c.index] = data.signedUrl;
      }),
  );
  return links;
}

/** Nome de arquivo de cada capítulo narrado, na ordem do audiolivro. */
export function nomesDosCapitulos(dados: DadosAudio): Map<number, string> {
  return nomesDosArquivos(dados.capitulos);
}

// ─── Amostra de cada voz ────────────────────────────────────────────────────

/** Texto da amostra: apresentação e um diálogo curto, para ouvir o tom e as falas. */
export function textoAmostra(nome: string, masculina: boolean): string {
  return (
    `Olá, eu sou ${masculina ? "o" : "a"} ${nome}. É assim que o seu livro pode soar.\n\n` +
    "— Você vem amanhã? — perguntou ela, já na porta.\n\n" +
    "Ele pensou por um instante e respondeu, sorrindo: — Venho, sim. Às nove em ponto, como combinamos."
  );
}

/**
 * Link (1h) da amostra de uma voz. Gerada na primeira vez que alguém pede e
 * guardada no bucket; a pasta leva a versão do motor, do estilo e do texto.
 */
export async function amostraDaVoz(admin: SupabaseClient, vozPedida: unknown): Promise<{ ok: true; url: string } | Falha> {
  if (!isVozAudio(vozPedida)) return { ok: false, status: 400, corpo: { error: "Voz inválida." } };
  const voz = AUDIO_VOZES.find((v) => v.id === vozPedida)!;
  const fala = normalizarParaFala(textoAmostra(voz.nome, voz.descricao.startsWith("Masculina")));
  const pasta = `amostras/${md5(`${AUDIO_VERSAO_MOTOR}|${AUDIO_ESTILO_VERSAO}|${fala}`).slice(0, 12)}`;
  const arquivo = `${voz.id}.mp3`;
  const caminho = `${pasta}/${arquivo}`;
  const assinar = async (): Promise<string | null> => {
    const { data } = await admin.storage.from(BUCKET).createSignedUrl(caminho, 3600);
    return data?.signedUrl ?? null;
  };

  const { data: lista } = await admin.storage.from(BUCKET).list(pasta, { search: arquivo });
  if ((lista ?? []).some((f) => f.name === arquivo)) {
    const url = await assinar();
    if (url) return { ok: true, url };
  }

  const esperadoMs = Math.round((fala.length / AUDIO_CARACTERES_POR_SEGUNDO) * 1000);
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const r = await sintetizar(fala, voz.id);
      const aparado = aparar(nivelar(r.pcm).pcm, r.taxa);
      const duracao = analisar(aparado, r.taxa).duracaoMs;
      const foraDoRitmo =
        duracao < esperadoMs * AUDIO_DURACAO_MIN - AUDIO_DURACAO_FOLGA_MS ||
        duracao > esperadoMs * AUDIO_DURACAO_MAX + AUDIO_DURACAO_FOLGA_MS;
      if (foraDoRitmo && tentativa < 2) continue;
      const mp3 = juntarBytes([
        codificarMp3(silencio(300, TAXA_SAIDA)),
        codificarMp3(reamostrar(masterizar(aparado, r.taxa).pcm, r.taxa, TAXA_SAIDA)),
      ]);
      const { error } = await admin.storage.from(BUCKET).upload(caminho, mp3, { contentType: "audio/mpeg", upsert: true });
      if (error) {
        console.error("[audiolivro] amostra upload:", error.message);
        return { ok: false, status: 500, corpo: { error: "Não foi possível preparar a amostra." } };
      }
      const url = await assinar();
      if (url) return { ok: true, url };
    } catch (e) {
      console.warn(`[audiolivro] amostra ${voz.id} tentativa ${tentativa}:`, e instanceof Error ? e.message : e);
      if (e instanceof ErroTts && e.tipo === "limite") {
        return { ok: false, status: 503, corpo: { error: "Muitas amostras ao mesmo tempo. Tente de novo em alguns segundos.", reason: "limite" } };
      }
    }
  }
  return { ok: false, status: 502, corpo: { error: "Não foi possível preparar a amostra agora. Tente de novo em instantes." } };
}

// ─── Amostra de um nome (etapa de pronúncia) ───────────────────────────────

/**
 * A voz escolhida fala a frase do livro em que o nome aparece, já com a
 * pronúncia que o autor escreveu. Guardada na pasta do livro; a mesma voz +
 * frase não é gerada duas vezes.
 */
export async function amostraDoNome(
  admin: SupabaseClient,
  livro: LivroParaAudio,
  livroId: string,
  vozPedida: unknown,
  grafiaPedida: unknown,
  falaPedida: unknown,
): Promise<{ ok: true; url: string; frase: string } | Falha> {
  if (!isVozAudio(vozPedida)) return { ok: false, status: 400, corpo: { error: "Escolha a voz antes de ouvir os nomes." } };
  const grafia = typeof grafiaPedida === "string" ? grafiaPedida.trim().slice(0, 80) : "";
  const fala = typeof falaPedida === "string" ? falaPedida.trim().slice(0, 80) : "";
  if (!grafia) return { ok: false, status: 400, corpo: { error: "Escreva o nome como está no livro." } };
  const frase = fraseComNome(segmentosDoLivro(livro).map((s) => s.texto), grafia) ?? `O nome ${grafia} aparece neste livro.`;
  const textoFala = normalizarParaFala(frase, fala ? [{ grafia, fala }] : []);
  const pasta = `${livroId}/amostras-nomes`;
  const arquivo = `${md5(`${AUDIO_VERSAO_MOTOR}|${AUDIO_ESTILO_VERSAO}|${vozPedida}|${textoFala}`).slice(0, 16)}.mp3`;
  const caminho = `${pasta}/${arquivo}`;
  const assinar = async (): Promise<string | null> => {
    const { data } = await admin.storage.from(BUCKET).createSignedUrl(caminho, 3600);
    return data?.signedUrl ?? null;
  };

  const { data: existentes } = await admin.storage.from(BUCKET).list(pasta, { limit: 1000 });
  const lista = (existentes ?? []).filter((f) => f.id);
  if (lista.some((f) => f.name === arquivo)) {
    const url = await assinar();
    if (url) return { ok: true, url, frase };
  }
  try {
    const r = await sintetizar(textoFala, vozPedida);
    const aparado = aparar(nivelar(r.pcm).pcm, r.taxa);
    const mp3 = juntarBytes([
      codificarMp3(silencio(200, TAXA_SAIDA)),
      codificarMp3(reamostrar(masterizar(aparado, r.taxa).pcm, r.taxa, TAXA_SAIDA)),
    ]);
    const { error } = await admin.storage.from(BUCKET).upload(caminho, mp3, { contentType: "audio/mpeg", upsert: true });
    if (error) {
      console.error("[audiolivro] amostra de nome upload:", error.message);
      return { ok: false, status: 500, corpo: { error: "Não foi possível preparar a amostra." } };
    }
    const url = await assinar();
    if (url) return { ok: true, url, frase };
    return { ok: false, status: 500, corpo: { error: "Não foi possível preparar a amostra." } };
  } catch (e) {
    console.warn("[audiolivro] amostra de nome:", e instanceof Error ? e.message : e);
    if (e instanceof ErroTts && e.tipo === "limite") {
      return { ok: false, status: 503, corpo: { error: "Muitas amostras ao mesmo tempo. Tente de novo em alguns segundos.", reason: "limite" } };
    }
    return { ok: false, status: 502, corpo: { error: "Não foi possível preparar a amostra agora. Tente de novo em instantes." } };
  }
}
