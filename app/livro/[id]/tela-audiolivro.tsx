"use client";

// Tela do audiolivro, adaptada da tela do audiolivro da Autoria (ver
// PROVENIENCIA.md): configurar (voz, capítulos, nomes e pronúncia) → gerar →
// ouvir, conferir, gerar de novo e editar a fala de trechos → baixar.
// Na demonstração, a narração anda enquanto a página está aberta (a tela
// chama "processar" em laço); sem plano, cobrança nem conclusão. Quem só tem
// o link ouve; quem enviou o livro (token) configura e ajusta.

import { useCallback, useEffect, useRef, useState } from "react";
import Etapas from "@/app/_componentes/etapas";
import { AUDIO_CARACTERES_POR_SEGUNDO, AUDIO_VOZES, type VozAudio } from "@/lib/audiolivro/config";
import { nomesDosArquivos } from "@/lib/audiolivro/nomes";
import type { DadosAudio, Pronuncia } from "@/lib/adaptadores/tipos";
import { MSG_SEM_CREDITOS } from "@/lib/adaptadores/avisos";

type PronunciaAudio = Pronuncia;

// ─── Tipos das respostas da rota ────────────────────────────────────────────

interface StatusAudio {
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

interface CapituloPrevia {
  index: number;
  titulo: string;
  caracteres: number;
  trechos: number;
}

interface TrechoParaAutor {
  id: string;
  capitulo: number;
  capitulo_titulo: string;
  ordem: number;
  estado: string;
  inicio: string;
  avisos: string[];
  duracao_ms: number | null;
  url: string | null;
  /** D60-C.1: texto que a voz fala (editável) e se já foi editado. */
  texto_fala: string;
  editado: boolean;
}

interface RespostaGet {
  livro: { id: string; titulo: string; subtitulo: string | null; autor: string; cortado: boolean; exemplo: boolean };
  dono: boolean;
  dados: DadosAudio | null;
  status: StatusAudio;
  links: Record<number, string>;
  previa: { capitulos: CapituloPrevia[]; caracteres: number } | null;
  limites: { caracteres: number; regeneracoes: number };
  creditos_esgotados: boolean;
}

/** O que uma preparação vai usar (devolvido pela rota para confirmar). */
interface UsoPreparacao {
  regeneracoes: number;
}

type Pendencia =
  | { tipo: "confirmar"; uso: UsoPreparacao; restantes: number; voz: VozAudio; descartadas: number }
  | { tipo: "regeneracoes"; precisa: number; restantes: number };

// ─── Textos e utilitários ───────────────────────────────────────────────────

/** Relógio, fora do render (validade dos links de amostra). */
const agora = () => Date.now();

const AVISO_TEXTO: Record<string, string> = {
  curto_demais: "a fala ficou mais curta que o texto",
  longo_demais: "a fala ficou mais longa que o texto",
  estourado: "o som saiu estourado",
  fala_diferente: "a fala não bate com o texto",
  sem_conferencia: "não foi possível conferir este trecho",
};

function duracaoEstimada(caracteres: number): string {
  const min = Math.max(1, Math.round(caracteres / AUDIO_CARACTERES_POR_SEGUNDO / 60));
  if (min < 60) return `cerca de ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `cerca de ${h}h${String(m).padStart(2, "0")}` : `cerca de ${h}h`;
}

function duracaoReal(ms: number | null): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
}

function milhar(n: number): string {
  return n.toLocaleString("pt-BR");
}

function nomeCapitulo(titulo: string): string {
  return titulo.trim() || "Abertura";
}

function nomeVoz(id: string | undefined): string {
  return AUDIO_VOZES.find((v) => v.id === id)?.nome ?? id ?? "";
}

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

// ─── Página ─────────────────────────────────────────────────────────────────

export default function TelaAudiolivro({ id, token }: { id: string; token: string | null }) {
  const [carregando, setCarregando] = useState(true);
  const [erroAcesso, setErroAcesso] = useState<string | null>(null);
  const [info, setInfo] = useState<RespostaGet | null>(null);

  const [voz, setVoz] = useState<VozAudio>(AUDIO_VOZES[0].id);
  const [pronuncias, setPronuncias] = useState<PronunciaAudio[]>([]);
  const [pronunciasAbertas, setPronunciasAbertas] = useState(false);

  const [rodando, setRodando] = useState(false);
  const rodandoRef = useRef(false);
  const pararRef = useRef(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const [trechosAbertos, setTrechosAbertos] = useState<Record<number, TrechoParaAutor[] | "carregando">>({});
  const [paraConferir, setParaConferir] = useState<TrechoParaAutor[]>([]);

  // D60-B3: amostra da voz (uma tocando por vez; link guardado por 50 min).
  const audioAmostra = useRef<HTMLAudioElement | null>(null);
  const linksAmostra = useRef<Record<string, { url: string; ate: number }>>({});
  const [amostra, setAmostra] = useState<{ voz: string; estado: "carregando" | "tocando" } | null>(null);

  // D60-C: etapa obrigatória de nomes e confirmação de cobrança.
  const [nomesConferidos, setNomesConferidos] = useState(false);
  const [pendencia, setPendencia] = useState<Pendencia | null>(null);

  const api = useCallback(
    async (corpo?: Record<string, unknown>, query = "") => {
      const auth: Record<string, string> = token ? { "x-livro-token": token } : {};
      const r = await fetch(`/api/audiolivro/${id}${query}`, corpo
        ? { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(corpo) }
        : { headers: auth, cache: "no-store" });
      const json = await r.json().catch(() => ({}));
      return { http: r.status, json };
    },
    [id, token],
  );

  // sincronizar = false no acompanhamento: não sobrescreve a voz e as
  // pronúncias que o autor pode estar editando enquanto a geração anda.
  const carregar = useCallback(async (sincronizar = true) => {
    const { http, json } = await api();
    if (http !== 200) { setErroAcesso(json.error ?? "Não foi possível abrir o audiolivro."); return null; }
    const r = json as RespostaGet;
    setInfo(r);
    if (r.dados && sincronizar) {
      setVoz(r.dados.voz as VozAudio);
      setPronuncias(r.dados.pronuncias ?? []);
    }
    if (r.status.terminado) {
      const c = await api(undefined, "?conferir=1");
      setParaConferir((c.json.trechos ?? []) as TrechoParaAutor[]);
    }
    return r;
  }, [api]);

  // Narração: enquanto a página está aberta, pede o próximo lote até terminar.
  const gerar = useCallback(async () => {
    if (rodandoRef.current) return;
    rodandoRef.current = true;
    pararRef.current = false;
    setRodando(true);
    setErro(null);
    setAviso(null);
    while (!pararRef.current) {
      const { http, json } = await api({ acao: "processar" });
      if (http !== 200 || !json.status) { setErro(json.error ?? "A geração parou com um erro. Tente continuar em instantes."); break; }
      const r = await carregar(false);
      if (json.limite_diario) { setAviso(MSG_SEM_CREDITOS); break; }
      const s = json.status as StatusAudio;
      if (!r || s.terminado) break;
      if (s.pendentes === 0 && s.gerando === 0) break; // sobraram só trechos que falharam
      if (json.aguardar_ms) await esperar(json.aguardar_ms as number);
    }
    rodandoRef.current = false;
    setRodando(false);
  }, [api, carregar]);

  // Entrada: carrega, marca a etapa (forward-only) e retoma a geração pendente.
  useEffect(() => {
    let vivo = true;
    (async () => {
      await carregar();
      if (!vivo) return;
      setCarregando(false);
    })();
    return () => { vivo = false; pararRef.current = true; audioAmostra.current?.pause(); };
  }, [carregar]);

  const retomou = useRef(false);
  useEffect(() => {
    if (retomou.current || !info?.dados || !info.dono || info.creditos_esgotados) return;
    const s = info.status;
    if (!s.terminado && (s.pendentes > 0 || s.gerando > 0)) { retomou.current = true; queueMicrotask(() => void gerar()); }
  }, [info, gerar]);

  // A rota devolve 409 com o que vai ser usado; o autor confirma e a mesma
  // chamada volta com { confirmar }. 402: faltam regenerações.
  async function preparar(comVoz: VozAudio, confirmar?: UsoPreparacao) {
    setOcupado(true);
    setErro(null);
    setPendencia(null);
    const limpas = pronuncias.filter((p) => p.grafia.trim() && p.fala.trim());
    const { http, json } = await api({ acao: "preparar", voz: comVoz, pronuncias: limpas, nomes_conferidos: true, confirmar });
    setOcupado(false);
    if (http === 409 && json.reason === "confirmar") {
      setPendencia({
        tipo: "confirmar",
        uso: json.uso as UsoPreparacao,
        restantes: json.regeneracoes_restantes as number,
        voz: comVoz,
        descartadas: (json.edicoes_descartadas as number | undefined) ?? 0,
      });
      return;
    }
    if (http === 402 && json.reason === "sem_regeneracoes") {
      setPendencia({ tipo: "regeneracoes", precisa: json.regeneracoes as number, restantes: json.restantes as number });
      return;
    }
    if (http !== 200) { setErro(json.error ?? "Não foi possível preparar o audiolivro."); return; }
    if (json.edicoes_descartadas > 0) {
      setAviso(`${json.edicoes_descartadas} trecho(s) com fala editada voltaram ao texto do livro, porque o texto ou a pronúncia mudou ali.`);
    }
    await carregar();
    retomou.current = true;
    void gerar();
  }

  async function regenerar(trechoId: string, capitulo: number) {
    setErro(null);
    const { http, json } = await api({ acao: "regenerar", trecho_id: trechoId });
    if (http === 402) { setErro(json.error ?? "As regenerações deste livro acabaram."); return; }
    if (http !== 200) { setErro(json.error ?? "Não foi possível gerar de novo."); return; }
    setTrechosAbertos((prev) => { const n = { ...prev }; delete n[capitulo]; return n; });
    setParaConferir((prev) => prev.filter((t) => t.id !== trechoId));
    await carregar();
    void gerar();
  }

  // D60-C.1: ajusta o texto falado de um trecho (ou restaura o original).
  // Devolve a mensagem de erro para a caixa de edição, ou null se deu certo.
  async function editarFala(trechoId: string, capitulo: number, texto: string, restaurar: boolean): Promise<string | null> {
    setErro(null);
    const { http, json } = await api({ acao: "editar_fala", trecho_id: trechoId, texto, restaurar });
    if (http === 402 && json.reason === "sem_regeneracoes") {
      return "As regenerações deste livro acabaram.";
    }
    if (http !== 200) return (json.error as string | undefined) ?? "Não foi possível salvar a edição.";
    setTrechosAbertos((prev) => { const n = { ...prev }; delete n[capitulo]; return n; });
    setParaConferir((prev) => prev.filter((t) => t.id !== trechoId));
    await carregar(false);
    void gerar();
    return null;
  }

  async function abrirTrechos(capitulo: number) {
    if (trechosAbertos[capitulo]) {
      setTrechosAbertos((prev) => { const n = { ...prev }; delete n[capitulo]; return n; });
      return;
    }
    setTrechosAbertos((prev) => ({ ...prev, [capitulo]: "carregando" }));
    const { json } = await api(undefined, `?capitulo=${capitulo}`);
    setTrechosAbertos((prev) => ({ ...prev, [capitulo]: (json.trechos ?? []) as TrechoParaAutor[] }));
  }

  async function baixarZip() {
    setOcupado(true);
    setErro(null);
    const r = await fetch(`/api/livros/${id}/zip`, { method: "POST" }).catch(() => null);
    const json = r ? await r.json().catch(() => ({})) : {};
    setOcupado(false);
    if (json.url) window.location.href = json.url as string;
    else setErro(json.error ?? "Não foi possível preparar o ZIP agora.");
  }

  async function ouvirAmostra(vozId: string) {
    const atual = audioAmostra.current;
    if (amostra?.voz === vozId) { atual?.pause(); setAmostra(null); return; }
    atual?.pause();
    setErro(null);
    setAmostra({ voz: vozId, estado: "carregando" });
    let url = linksAmostra.current[vozId]?.ate > agora() ? linksAmostra.current[vozId].url : null;
    if (!url) {
      const { http, json } = await api(undefined, `?amostra=${encodeURIComponent(vozId)}`);
      if (http !== 200 || !json.url) {
        setErro(json.error ?? "Não foi possível tocar a amostra agora.");
        setAmostra((a) => (a?.voz === vozId ? null : a));
        return;
      }
      url = json.url as string;
      linksAmostra.current[vozId] = { url, ate: agora() + 50 * 60_000 };
    }
    const audio = new Audio(url);
    audioAmostra.current = audio;
    audio.onended = () => setAmostra((a) => (a?.voz === vozId ? null : a));
    try {
      await audio.play();
      setAmostra((a) => (a?.voz === vozId ? { voz: vozId, estado: "tocando" } : a));
    } catch {
      setAmostra((a) => (a?.voz === vozId ? null : a));
    }
  }

  // D60-C: a voz escolhida fala o nome numa frase do livro, com a pronúncia
  // escrita pelo autor. Usa o mesmo tocador (e o mesmo estado) da amostra da voz.
  async function ouvirNome(comVoz: string, grafia: string, fala: string) {
    const chave = `nome:${comVoz}:${grafia}:${fala}`;
    const atual = audioAmostra.current;
    if (amostra?.voz === chave) { atual?.pause(); setAmostra(null); return; }
    atual?.pause();
    setErro(null);
    setAmostra({ voz: chave, estado: "carregando" });
    let url = linksAmostra.current[chave]?.ate > agora() ? linksAmostra.current[chave].url : null;
    if (!url) {
      const { http, json } = await api({ acao: "amostra_nome", voz: comVoz, grafia, fala });
      if (http !== 200 || !json.url) {
        setErro(json.error ?? "Não foi possível tocar a amostra do nome agora.");
        setAmostra((a) => (a?.voz === chave ? null : a));
        return;
      }
      url = json.url as string;
      linksAmostra.current[chave] = { url, ate: agora() + 50 * 60_000 };
    }
    const audio = new Audio(url);
    audioAmostra.current = audio;
    audio.onended = () => setAmostra((a) => (a?.voz === chave ? null : a));
    try {
      await audio.play();
      setAmostra((a) => (a?.voz === chave ? { voz: chave, estado: "tocando" } : a));
    } catch {
      setAmostra((a) => (a?.voz === chave ? null : a));
    }
  }

  // D60-B3: a IA lê os nomes do livro e sugere como falar; nada é gravado.
  async function sugerirNomes(): Promise<PronunciaAudio[] | string> {
    const { http, json } = await api({ acao: "sugerir_pronuncias" });
    if (http !== 200) return (json.error as string | undefined) ?? "Não foi possível sugerir agora.";
    return (json.sugestoes ?? []) as PronunciaAudio[];
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const dados = info?.dados ?? null;
  const status = info?.status;
  const dono = info?.dono ?? false;
  const regeneracoesRestantes = info && dados ? Math.max(0, info.limites.regeneracoes - dados.regeneracoes_usadas) : 0;
  const nomesArquivos = nomesDosArquivos(dados?.capitulos ?? []);
  const ouvindoNome = amostra?.voz.startsWith("nome:") ? amostra : null;

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-3xl px-5 py-10">
        {dono && <div className="mb-6"><Etapas atual={3} /></div>}
        <div className="mb-8">
          <p className="text-sm font-medium text-latao mb-1">Audiolivro</p>
          <h1 className="font-serif text-3xl text-tinta">{info?.livro.titulo ?? "Seu livro narrado"}</h1>
          {info?.livro.autor && <p className="mt-1 text-tinta-suave">{info.livro.autor}</p>}
          <p className="text-tinta-suave mt-2 text-sm leading-relaxed max-w-2xl">
            Narração com inteligência artificial, conferida trecho a trecho, com um arquivo de áudio por capítulo.
          </p>
        </div>

        {carregando && (
          <div className="flex items-center justify-center py-24">
            <div className="w-10 h-10 rounded-full border-4 border-latao border-t-transparent animate-spin" />
          </div>
        )}

        {!carregando && erroAcesso && (
          <div className="bg-folha border border-erro/30 rounded-xl p-4 text-sm text-erro">{erroAcesso}</div>
        )}

        {info?.creditos_esgotados && (
          <div role="status" className="bg-latao-claro/50 border border-latao/40 rounded-xl p-4 text-sm text-tinta mb-6">{MSG_SEM_CREDITOS}</div>
        )}
        {info?.livro.cortado && (
          <div className="bg-folha border border-linha rounded-xl p-4 text-sm text-tinta-suave mb-6">
            O livro passou do limite da demonstração ({milhar(info.limites.caracteres)} caracteres): entraram só os primeiros capítulos.
          </div>
        )}
        {erro && <div role="alert" className="bg-folha border border-erro/30 rounded-xl p-4 text-sm text-erro mb-6">{erro}</div>}

        {/* ── Confirmação do que a mudança vai usar / regenerações esgotadas ── */}
        {pendencia && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div role="dialog" aria-modal="true" className="bg-folha rounded-2xl max-w-md w-full p-6 space-y-4">
              {pendencia.tipo === "confirmar" && (
                <>
                  <p className="font-serif text-lg text-tinta">Confirme antes de seguir</p>
                  <ul className="text-sm text-tinta-suave space-y-1.5 list-disc pl-5">
                    {pendencia.uso.regeneracoes > 0 && (
                      <li>
                        Refaz {pendencia.uso.regeneracoes} trecho{pendencia.uso.regeneracoes > 1 ? "s" : ""} já narrado{pendencia.uso.regeneracoes > 1 ? "s" : ""} e usa {pendencia.uso.regeneracoes} regeneraç{pendencia.uso.regeneracoes > 1 ? "ões" : "ão"} (restam {pendencia.restantes})
                      </li>
                    )}
                    {pendencia.descartadas > 0 && (
                      <li>
                        {pendencia.descartadas} trecho{pendencia.descartadas > 1 ? "s" : ""} com fala editada volta{pendencia.descartadas > 1 ? "m" : ""} ao texto do livro
                      </li>
                    )}
                  </ul>
                  <div className="flex flex-wrap justify-end gap-3">
                    <button onClick={() => setPendencia(null)} className="text-sm px-4 py-2 rounded-lg border border-linha text-tinta-suave">Cancelar</button>
                    <button
                      onClick={() => void preparar(pendencia.voz, pendencia.uso)}
                      disabled={ocupado}
                      className="text-sm px-4 py-2 rounded-lg bg-tinta text-folha font-semibold disabled:opacity-50"
                    >
                      Confirmar
                    </button>
                  </div>
                </>
              )}
              {pendencia.tipo === "regeneracoes" && (
                <>
                  <p className="font-serif text-lg text-tinta">As regenerações acabaram</p>
                  <p className="text-sm text-tinta-suave">
                    Esta mudança refaz {pendencia.precisa} trecho{pendencia.precisa > 1 ? "s" : ""} já narrado{pendencia.precisa > 1 ? "s" : ""}, e restam {pendencia.restantes} regenerações neste livro. Na demonstração, cada livro tem {info?.limites.regeneracoes ?? 10}.
                  </p>
                  <div className="flex justify-end">
                    <button onClick={() => setPendencia(null)} className="text-sm px-4 py-2 rounded-lg border border-linha text-tinta-suave">Fechar</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {aviso && <div className="bg-latao-claro/50 border border-latao/40 rounded-xl p-4 text-sm text-tinta mb-6">{aviso}</div>}

        {/* ── Configurar (antes de preparar) ─────────────────────────────── */}
        {!carregando && info && !dados && !dono && (
          <p className="text-tinta-suave">A narração deste livro ainda não começou.</p>
        )}

        {!carregando && info && !dados && dono && info.previa && (
          <div className="space-y-6">
            <section className="bg-folha rounded-2xl border border-linha p-6">
              <p className="text-sm font-medium text-tinta-suave mb-4">1. Escolha a voz</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {AUDIO_VOZES.map((v) => {
                  const estadoAmostra = amostra?.voz === v.id ? amostra.estado : null;
                  return (
                    <div
                      key={v.id}
                      className={`flex items-center gap-2 pl-4 pr-2 py-3 rounded-xl border transition-colors ${voz === v.id ? "border-latao bg-latao-claro/30" : "border-linha hover:border-latao/40"}`}
                    >
                      <button onClick={() => setVoz(v.id)} aria-pressed={voz === v.id} className="flex flex-col items-start flex-1 min-w-0 text-left">
                        <span className={`text-sm font-medium ${voz === v.id ? "text-tinta" : "text-tinta/80"}`}>{v.nome}</span>
                        <span className="text-xs text-tinta-suave">{v.descricao}</span>
                      </button>
                      <button
                        onClick={() => void ouvirAmostra(v.id)}
                        aria-label={estadoAmostra === "tocando" ? `Parar a amostra de ${v.nome}` : `Ouvir a voz de ${v.nome}`}
                        className="shrink-0 w-9 h-9 rounded-full border border-linha bg-folha text-tinta hover:border-latao/60 flex items-center justify-center"
                      >
                        {estadoAmostra === "carregando" ? (
                          <span className="w-4 h-4 rounded-full border-2 border-latao border-t-transparent animate-spin" />
                        ) : estadoAmostra === "tocando" ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4" /></svg>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-tinta-suave mt-3">
                Toque no botão de cada voz para ouvir uma amostra (a primeira vez leva alguns segundos). A voz não pode ser trocada depois que a narração começa.
              </p>
            </section>

            <section className="bg-folha rounded-2xl border border-linha p-6">
              <p className="text-sm font-medium text-tinta-suave mb-4">2. Capítulos</p>
              <ul className="divide-y divide-linha">
                {info.previa.capitulos.map((c) => (
                  <li key={c.index} className="py-2.5 flex items-center justify-between gap-4 text-sm">
                    <span className={`truncate ${c.trechos === 0 ? "text-tinta-suave" : "text-tinta"}`}>{nomeCapitulo(c.titulo)}</span>
                    <span className="shrink-0 text-xs text-tinta-suave">
                      {c.trechos === 0 ? "sem texto, não será narrado" : duracaoEstimada(c.caracteres)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-tinta-suave mt-3">Os capítulos são os que você aprovou ao enviar o livro, com os créditos de abertura e de encerramento.</p>
            </section>

            <section className="bg-folha rounded-2xl border border-linha p-6">
              <EditorPronuncias
                pronuncias={pronuncias}
                setPronuncias={setPronuncias}
                titulo="3. Nomes e pronúncia"
                semCaixa
                onSugerir={sugerirNomes}
                onOuvir={(g, f) => void ouvirNome(voz, g, f)}
                ouvindo={ouvindoNome ? { chave: ouvindoNome.voz, estado: ouvindoNome.estado } : null}
                vozAtual={voz}
              />
              <label className="mt-5 flex items-start gap-3 rounded-xl bg-latao-claro/30 border border-latao/30 p-4 cursor-pointer">
                <input type="checkbox" checked={nomesConferidos} onChange={(e) => setNomesConferidos(e.target.checked)} className="mt-0.5 accent-[var(--tinta)]" />
                <span className="text-sm text-tinta">
                  Conferi os nomes e ouvi como a voz fala os que podem sair errado.
                  <span className="block text-xs text-tinta-suave mt-1">
                    Depois que a narração começa, corrigir uma pronúncia refaz os trechos com aquele nome, e cada trecho refeito usa uma regeneração.
                  </span>
                </span>
              </label>
            </section>

            <section className="bg-folha rounded-2xl border border-linha p-6 flex flex-wrap items-center justify-between gap-4">
              <div className="text-sm text-tinta-suave">
                <p>
                  {milhar(info.previa.caracteres)} de {milhar(info.limites.caracteres)} caracteres · {duracaoEstimada(info.previa.caracteres)} de áudio
                </p>
                <p className="text-xs mt-1">Mantenha esta página aberta enquanto o livro é narrado.</p>
              </div>
              <button
                onClick={() => preparar(voz)}
                disabled={ocupado || info.previa.caracteres === 0 || !nomesConferidos || info.creditos_esgotados}
                className="inline-flex items-center bg-tinta text-folha px-7 py-3 rounded-xl font-semibold text-sm hover:bg-tinta/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {ocupado ? "Preparando..." : "Gerar audiolivro"}
              </button>
            </section>
          </div>
        )}

        {/* ── Gerando / pronto ───────────────────────────────────────────── */}
        {!carregando && info && dados && status && (
          <div className="space-y-6">
            <section className="bg-folha rounded-2xl border border-linha p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <p className="text-sm text-tinta-suave">
                  Voz: <span className="font-medium text-tinta">{nomeVoz(dados.voz)}</span>
                  {" · "}{milhar(dados.caracteres)} caracteres
                  {dono && <>{" · "}Regenerações: {regeneracoesRestantes} de {info.limites.regeneracoes}</>}
                </p>
                {dono && !status.terminado && !rodando && !info.creditos_esgotados && (
                  <button onClick={() => void gerar()} className="text-xs px-4 py-2 rounded-lg bg-tinta text-folha font-semibold">Continuar a geração</button>
                )}
              </div>
              <div className="w-full h-2 bg-linha rounded-full overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={status.total ? Math.round((status.prontos / status.total) * 100) : 0}>
                <div className="h-full bg-latao transition-all" style={{ width: `${status.total ? Math.round((status.prontos / status.total) * 100) : 0}%` }} />
              </div>
              <p className="text-xs text-tinta-suave mt-2" aria-live="polite">
                {status.prontos} de {status.total} trechos · {status.capitulos_montados} de {status.capitulos} capítulos prontos
                {status.falhos > 0 && ` · ${status.falhos} trecho(s) com falha`}
              </p>
              {dono && !status.terminado && (
                <p className="text-xs text-tinta-suave mt-3">
                  {rodando ? "Narrando. Mantenha esta página aberta: a narração anda enquanto ela está aberta." : "A narração está pausada. Toque em continuar para seguir de onde parou."}
                </p>
              )}
              {dono && regeneracoesRestantes === 0 && (
                <p className="text-xs text-erro mt-3">As regenerações deste livro acabaram: não é mais possível gerar de novo nem editar a fala de trechos já narrados.</p>
              )}
            </section>

            {dono && status.terminado && paraConferir.length > 0 && (
              <section className="bg-folha rounded-2xl border border-latao/40 p-6">
                <p className="text-sm font-medium text-tinta mb-1">Confira estes trechos</p>
                <p className="text-xs text-tinta-suave mb-4">A conferência automática encontrou algo diferente do texto. Ouça e, se precisar, gere de novo.</p>
                <ListaTrechos trechos={paraConferir} restantes={regeneracoesRestantes} rodando={rodando} onRegenerar={regenerar} onEditar={editarFala} comCapitulo />
              </section>
            )}

            <section className="bg-folha rounded-2xl border border-linha p-6">
              <p className="text-sm font-medium text-tinta-suave mb-4">Capítulos</p>
              <ul className="space-y-3">
                {dados.capitulos.map((c) => {
                  const url = info.links[c.index];
                  const nomeArquivo = nomesArquivos.get(c.index);
                  const abertos = trechosAbertos[c.index];
                  return (
                    <li key={c.index} className="rounded-xl border border-linha p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className={`font-serif truncate ${c.trechos === 0 ? "text-tinta-suave" : "text-tinta"}`}>{nomeCapitulo(c.titulo)}</p>
                          <p className="text-xs text-tinta-suave">
                            {c.trechos === 0
                              ? "sem texto, não narrado"
                              : c.montado_em ? `pronto · ${duracaoReal(c.duracao_ms)}` : "na fila"}
                          </p>
                        </div>
                        {c.trechos > 0 && (
                          <div className="flex items-center gap-3">
                            {url && (
                              <a href={url} download={nomeArquivo} className="text-xs text-tinta underline">Baixar áudio</a>
                            )}
                            <button onClick={() => abrirTrechos(c.index)} aria-expanded={!!abertos} className="text-xs text-tinta-suave hover:text-tinta underline">
                              {abertos ? "Fechar trechos" : "Ver trechos"}
                            </button>
                          </div>
                        )}
                      </div>
                      {url && <audio controls preload="none" src={url} className="w-full mt-3" />}
                      {abertos === "carregando" && <p className="text-xs text-tinta-suave mt-3">Carregando trechos...</p>}
                      {Array.isArray(abertos) && (
                        <div className="mt-3">
                          <ListaTrechos trechos={abertos} restantes={regeneracoesRestantes} rodando={rodando} onRegenerar={regenerar} onEditar={editarFala} somenteOuvir={!dono} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            {dono && (
              <section className="bg-folha rounded-2xl border border-linha p-6">
                <button onClick={() => setPronunciasAbertas((v) => !v)} aria-expanded={pronunciasAbertas} className="text-sm text-tinta underline">
                  {pronunciasAbertas ? "Fechar pronúncias" : "Ajustar pronúncia de nomes"}
                </button>
                {pronunciasAbertas && (
                  <div className="mt-4">
                    <EditorPronuncias
                      pronuncias={pronuncias}
                      setPronuncias={setPronuncias}
                      titulo=""
                      semCaixa
                      onSugerir={sugerirNomes}
                      onOuvir={(g, f) => void ouvirNome(dados.voz, g, f)}
                      ouvindo={ouvindoNome ? { chave: ouvindoNome.voz, estado: ouvindoNome.estado } : null}
                      vozAtual={dados.voz}
                    />
                    <button
                      onClick={() => preparar(dados.voz as VozAudio)}
                      disabled={ocupado || rodando}
                      className="mt-4 text-xs px-4 py-2 rounded-lg bg-tinta text-folha font-semibold disabled:opacity-50"
                    >
                      Salvar e refazer só os trechos com esses nomes
                    </button>
                    <p className="text-xs text-tinta-suave mt-2">
                      Cada trecho já narrado que tiver o nome é refeito e usa uma regeneração. Antes de refazer, mostramos quantas.
                    </p>
                  </div>
                )}
              </section>
            )}

            <section className="bg-folha rounded-2xl border border-linha p-6 flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-tinta-suave">
                {status.terminado
                  ? "Tudo pronto. Um arquivo por capítulo, numerados na ordem em que o livro toca, com os créditos nas pontas."
                  : "O ZIP com todos os capítulos fica disponível quando a narração terminar."}
              </p>
              <button
                onClick={() => void baixarZip()}
                disabled={!status.terminado || ocupado}
                className="inline-flex items-center bg-tinta text-folha px-7 py-3 rounded-xl font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {ocupado ? "Juntando os arquivos..." : "Baixar o audiolivro (ZIP)"}
              </button>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Componentes ────────────────────────────────────────────────────────────

function ListaTrechos({
  trechos, restantes, rodando, onRegenerar, onEditar, comCapitulo, somenteOuvir,
}: {
  trechos: TrechoParaAutor[];
  restantes: number;
  rodando: boolean;
  onRegenerar: (trechoId: string, capitulo: number) => void;
  /** D60-C.1: salva o texto falado editado (ou restaura). Devolve erro ou null. */
  onEditar: (trechoId: string, capitulo: number, texto: string, restaurar: boolean) => Promise<string | null>;
  /** D60-B2: na lista "Confira estes trechos", mostra de qual capítulo é. */
  comCapitulo?: boolean;
  /** Quem só tem o link: ouve, sem gerar de novo nem editar. */
  somenteOuvir?: boolean;
}) {
  if (trechos.length === 0) return <p className="text-xs text-tinta-suave">Nenhum trecho.</p>;
  return (
    <ul className="space-y-3">
      {trechos.map((t) => (
        <ItemTrecho key={t.id} t={t} restantes={restantes} rodando={rodando} onRegenerar={onRegenerar} onEditar={onEditar} comCapitulo={comCapitulo} somenteOuvir={somenteOuvir} />
      ))}
    </ul>
  );
}

function ItemTrecho({
  t, restantes, rodando, onRegenerar, onEditar, comCapitulo, somenteOuvir,
}: {
  t: TrechoParaAutor;
  restantes: number;
  rodando: boolean;
  onRegenerar: (trechoId: string, capitulo: number) => void;
  onEditar: (trechoId: string, capitulo: number, texto: string, restaurar: boolean) => Promise<string | null>;
  comCapitulo?: boolean;
  somenteOuvir?: boolean;
}) {
  const falhou = t.estado === "falhou";
  const gastaCota = t.estado === "pronto";
  const semCota = gastaCota && restantes <= 0;
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(t.texto_fala);
  const [salvando, setSalvando] = useState(false);
  const [erroEdicao, setErroEdicao] = useState<string | null>(null);
  const custo = gastaCota ? "usa 1 regeneração" : "sem custo";

  async function salvar(restaurar: boolean) {
    setSalvando(true);
    setErroEdicao(null);
    const e = await onEditar(t.id, t.capitulo, texto, restaurar);
    setSalvando(false);
    if (e) { setErroEdicao(e); return; }
    setEditando(false);
  }

  return (
    <li className="rounded-lg bg-papel p-3">
      <p className="text-xs text-tinta-suave leading-relaxed">
        <span className="font-medium text-tinta">
          {comCapitulo ? `${nomeCapitulo(t.capitulo_titulo)} · ` : ""}Trecho {t.ordem + 1}:
        </span>{" "}
        {t.inicio}...
        {t.editado && <span className="ml-2 rounded border border-latao/40 px-1.5 py-0.5 text-[10px] text-tinta">fala editada</span>}
      </p>
      {(t.avisos.length > 0 || falhou) && (
        <p className="text-xs text-latao mt-1">
          {falhou ? "não foi possível gerar este trecho" : t.avisos.map((a) => AVISO_TEXTO[a] ?? a).join("; ")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 mt-2">
        {t.url && <audio controls preload="none" src={t.url} className="h-8 flex-1 min-w-[220px]" />}
        {!somenteOuvir && (t.estado === "pronto" || falhou) && (
          <>
            <button
              onClick={() => onRegenerar(t.id, t.capitulo)}
              disabled={rodando || semCota}
              className="text-xs px-3 py-1.5 rounded-lg border border-linha text-tinta-suave hover:border-latao/40 disabled:opacity-50"
            >
              {falhou ? "Tentar de novo" : `Gerar de novo · restam ${restantes}`}
            </button>
            <button
              onClick={() => { setTexto(t.texto_fala); setErroEdicao(null); setEditando((v) => !v); }}
              disabled={rodando}
              className="text-xs text-tinta-suave hover:text-tinta underline disabled:opacity-50"
            >
              {editando ? "Fechar edição" : "Editar fala"}
            </button>
          </>
        )}
        {(t.estado === "pendente" || t.estado === "gerando") && <span className="text-xs text-tinta-suave">na fila</span>}
      </div>
      {editando && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-tinta-suave">
            Este é o texto que a voz fala neste trecho (números e nomes já como serão falados). Ajuste palavras, pontuação ou pausas; o texto do livro não muda.
          </p>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-linha px-3 py-2 text-sm leading-relaxed"
          />
          {erroEdicao && <p className="text-xs text-erro">{erroEdicao}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void salvar(false)}
              disabled={salvando || semCota || !texto.trim() || texto === t.texto_fala}
              className="text-xs px-3 py-1.5 rounded-lg bg-tinta text-latao font-semibold disabled:opacity-50"
            >
              {salvando ? "Salvando..." : `Salvar e gerar de novo · ${custo}`}
            </button>
            {t.editado && (
              <button
                onClick={() => void salvar(true)}
                disabled={salvando || semCota}
                className="text-xs text-tinta-suave hover:text-tinta underline disabled:opacity-50"
              >
                Restaurar o texto original · {custo}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function EditorPronuncias({
  pronuncias, setPronuncias, titulo, semCaixa, onSugerir, onOuvir, ouvindo, vozAtual,
}: {
  pronuncias: PronunciaAudio[];
  setPronuncias: (p: PronunciaAudio[]) => void;
  titulo: string;
  semCaixa?: boolean;
  /** D60-B3: pede à IA os nomes do livro que a voz pode ler errado. */
  onSugerir?: () => Promise<PronunciaAudio[] | string>;
  /** D60-C: toca a voz falando o nome numa frase do livro. */
  onOuvir?: (grafia: string, fala: string) => void;
  ouvindo?: { chave: string; estado: "carregando" | "tocando" } | null;
  vozAtual?: string;
}) {
  const atualizar = (i: number, campo: keyof PronunciaAudio, valor: string) =>
    setPronuncias(pronuncias.map((p, k) => (k === i ? { ...p, [campo]: valor } : p)));
  const [sugestoes, setSugestoes] = useState<PronunciaAudio[] | null>(null);
  const [sugerindo, setSugerindo] = useState(false);
  const [erroSugestao, setErroSugestao] = useState<string | null>(null);
  const cadastradas = new Set(pronuncias.map((p) => p.grafia.trim()));
  const pendentes = (sugestoes ?? []).filter((s) => !cadastradas.has(s.grafia));
  const adicionar = (lista: PronunciaAudio[]) =>
    setPronuncias([...pronuncias.filter((p) => p.grafia.trim() || p.fala.trim()), ...lista.map((s) => ({ ...s }))]);
  async function sugerir() {
    if (!onSugerir) return;
    setSugerindo(true);
    setErroSugestao(null);
    const r = await onSugerir();
    setSugerindo(false);
    if (typeof r === "string") { setErroSugestao(r); return; }
    setSugestoes(r);
  }
  const conteudo = (
    <>
      {titulo && <p className="text-sm font-medium text-tinta-suave mb-4">{titulo}</p>}
      <p className="text-xs text-tinta-suave mb-4">
        Para nomes que a voz pode ler errado: escreva como está no livro e como deve soar. Ex.: escrito &quot;Jacques&quot;, falado &quot;Jác&quot;.
        {onOuvir && " Toque no botão ao lado para ouvir a voz dizendo o nome numa frase do livro."}
      </p>
      <div className="space-y-2">
        {pronuncias.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input value={p.grafia} onChange={(e) => atualizar(i, "grafia", e.target.value)} placeholder="Como está escrito" maxLength={80}
              className="flex-1 min-w-[160px] rounded-lg border border-linha px-3 py-2 text-sm" />
            <span className="text-tinta-suave">→</span>
            <input value={p.fala} onChange={(e) => atualizar(i, "fala", e.target.value)} placeholder="Como se fala" maxLength={80}
              className="flex-1 min-w-[160px] rounded-lg border border-linha px-3 py-2 text-sm" />
            {onOuvir && p.grafia.trim() && (() => {
              const chave = `nome:${vozAtual ?? ""}:${p.grafia.trim()}:${p.fala.trim()}`;
              const estado = ouvindo?.chave === chave ? ouvindo.estado : null;
              return (
                <button
                  onClick={() => onOuvir(p.grafia.trim(), p.fala.trim())}
                  aria-label={estado === "tocando" ? "Parar" : `Ouvir ${p.grafia.trim()}`}
                  className="shrink-0 w-8 h-8 rounded-full border border-linha bg-folha text-tinta hover:border-latao/60 flex items-center justify-center"
                >
                  {estado === "carregando" ? (
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-latao border-t-transparent animate-spin" />
                  ) : estado === "tocando" ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4" /></svg>
                  )}
                </button>
              );
            })()}
            <button onClick={() => setPronuncias(pronuncias.filter((_, k) => k !== i))} className="text-xs text-tinta-suave hover:text-erro">remover</button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <button onClick={() => setPronuncias([...pronuncias, { grafia: "", fala: "" }])} className="text-xs text-latao underline">
          + adicionar nome
        </button>
        {onSugerir && (
          <button onClick={() => void sugerir()} disabled={sugerindo} className="text-xs text-tinta underline disabled:opacity-50">
            {sugerindo ? "Lendo os nomes do livro..." : "Sugerir nomes do livro"}
          </button>
        )}
      </div>
      {erroSugestao && <p className="text-xs text-erro mt-2">{erroSugestao}</p>}
      {sugestoes && (
        <div className="mt-4 rounded-xl bg-papel p-4">
          {pendentes.length === 0 ? (
            <p className="text-xs text-tinta-suave">Nenhum nome novo para sugerir.</p>
          ) : (
            <>
              <p className="text-xs text-tinta-suave mb-3">
                Sugestões a partir dos nomes do livro. Confira como cada um deve soar, ajuste se precisar depois de adicionar, e salve.
              </p>
              <ul className="space-y-2">
                {pendentes.map((s) => (
                  <li key={s.grafia} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-tinta">{s.grafia}</span>
                    <span className="text-tinta-suave">→</span>
                    <span className="text-tinta">{s.fala}</span>
                    <button onClick={() => adicionar([s])} className="ml-auto text-xs text-latao underline">adicionar</button>
                  </li>
                ))}
              </ul>
              <button onClick={() => adicionar(pendentes)} className="mt-3 text-xs px-3 py-1.5 rounded-lg border border-linha text-tinta-suave hover:border-latao/40">
                Adicionar todas
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
  return semCaixa ? <div>{conteudo}</div> : <section className="bg-folha rounded-2xl border border-linha p-6">{conteudo}</section>;
}
