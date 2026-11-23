"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { lerToken } from "@/app/_componentes/token";
import Etapas from "@/app/_componentes/etapas";
import AprovacaoCapitulos from "@/app/_componentes/aprovacao-capitulos";

// ─── Tipos da resposta de GET /api/livros/[id] ─────────────────────────────

interface Voz { id: string; nome: string; descricao: string }
interface CapPrevia { index: number; titulo: string; caracteres: number; trechos: number }
interface CapAudio { index: number; titulo: string; trechos: number; duracao_ms: number | null; url: string | null; arquivo: string | null }
interface Status { total: number; prontos: number; pendentes: number; gerando: number; falhos: number; com_aviso: number; capitulos: number; capitulos_montados: number; terminado: boolean }
interface Pronuncia { grafia: string; fala: string }
interface EstadoCapitulos {
  livro: Estado["livro"];
  dono: boolean;
  etapa: "capitulos";
}
interface Estado {
  etapa: "narracao";
  livro: { id: string; titulo: string; subtitulo: string | null; autor: string; cortado: boolean; exemplo: boolean };
  dono: boolean;
  limite_caracteres: number;
  previa: { capitulos: CapPrevia[]; caracteres: number };
  vozes: Voz[];
  nomes: { nome: string; vezes: number }[];
  audio: { voz: string; pronuncias: Pronuncia[]; regeneracoes_usadas: number; regeneracoes_limite: number; capitulos: CapAudio[] } | null;
  status: Status;
}
interface Trecho {
  id: string; capitulo: number; ordem: number; estado: string; inicio: string; texto_fala: string;
  editado: boolean; avisos: string[]; duracao_ms: number | null; url: string | null;
}

const AVISOS: Record<string, string> = {
  curto_demais: "Ficou mais curto que o esperado",
  longo_demais: "Ficou mais longo que o esperado",
  estourado: "Volume alto demais",
  fala_diferente: "A fala pode ter diferenças do texto",
  sem_conferencia: "Não foi conferido por transcrição",
};

function nomeSegmento(t: string) {
  return t.trim() || "Abertura";
}

function minutos(ms: number | null) {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}min${String(s % 60).padStart(2, "0")}`;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Tela ───────────────────────────────────────────────────────────────────

export default function TelaLivro({ id }: { id: string }) {
  const [estado, setEstado] = useState<Estado | EstadoCapitulos | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [narrando, setNarrando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aberto, setAberto] = useState<number | null>(null);
  const [versaoTrechos, setVersaoTrechos] = useState(0);
  const vivo = useRef(true);

  const cabecalhos = useCallback(
    (json = false): HeadersInit => ({ ...(token ? { "x-livro-token": token } : {}), ...(json ? { "Content-Type": "application/json" } : {}) }),
    [token],
  );

  const carregar = useCallback(async (): Promise<Estado | EstadoCapitulos | null> => {
    const res = await fetch(`/api/livros/${id}`, { headers: cabecalhos(), cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) {
      setErroCarga(json?.error ?? "Não foi possível abrir este livro.");
      return null;
    }
    setEstado(json as Estado | EstadoCapitulos);
    return json as Estado | EstadoCapitulos;
  }, [id, cabecalhos]);

  // Token deste navegador (só quem enviou o livro tem).
  useEffect(() => {
    vivo.current = true;
    const t = lerToken(id);
    queueMicrotask(() => setToken(t));
    return () => {
      vivo.current = false;
    };
  }, [id]);

  useEffect(() => {
    queueMicrotask(() => void carregar());
  }, [carregar]);

  // Laço da narração: enquanto a página está aberta e falta trecho, pede o próximo lote.
  useEffect(() => {
    if (!narrando) return;
    let parar = false;
    (async () => {
      while (!parar && vivo.current) {
        const res = await fetch(`/api/livros/${id}/processar`, { method: "POST", headers: cabecalhos() }).catch(() => null);
        const json = res ? await res.json().catch(() => null) : null;
        if (parar) return;
        if (!res || !res.ok || !json?.ok) {
          setAviso(json?.error ?? "A narração parou por uma falha de conexão. Toque em continuar.");
          setNarrando(false);
          return;
        }
        await carregar();
        setVersaoTrechos((v) => v + 1);
        if (json.limite_diario) {
          setAviso("O serviço de voz atingiu o limite de hoje. A narração continua de onde parou quando você voltar amanhã.");
          setNarrando(false);
          return;
        }
        const s = json.status as Status;
        if (s.terminado || (s.pendentes === 0 && s.gerando === 0)) {
          setNarrando(false);
          return;
        }
        if (json.aguardar_ms) await esperar(json.aguardar_ms);
      }
    })();
    return () => {
      parar = true;
    };
  }, [narrando, id, cabecalhos, carregar]);

  const comecar = useCallback(async (voz: string, pronuncias: Pronuncia[]) => {
    setAviso(null);
    const res = await fetch(`/api/livros/${id}/preparar`, { method: "POST", headers: cabecalhos(true), body: JSON.stringify({ voz, pronuncias }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAviso(json.error ?? "Não foi possível começar a narração.");
      return;
    }
    await carregar();
    setNarrando(true);
  }, [id, cabecalhos, carregar]);

  const continuar = useCallback(() => {
    setAviso(null);
    setNarrando(true);
  }, []);

  if (erroCarga) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-12">
        <p className="text-erro">{erroCarga}</p>
        <Link href="/" className="mt-4 inline-block underline">Enviar um livro</Link>
      </div>
    );
  }
  if (!estado) {
    return <div className="mx-auto max-w-3xl px-5 py-12 text-tinta-suave">Abrindo o livro…</div>;
  }

  if (estado.etapa === "capitulos") {
    return (
      <div className="mx-auto max-w-3xl px-5 py-10">
        <Etapas atual={2} />
        <h1 className="mt-6 font-serif text-3xl leading-tight sm:text-4xl">{estado.livro.titulo}</h1>
        <p className="mt-2 text-tinta-suave">{estado.livro.autor}</p>
        {estado.dono && token ? (
          <AprovacaoCapitulos id={id} token={token} onAprovado={() => void carregar()} />
        ) : (
          <p className="mt-6 text-tinta-suave">Este livro ainda está sendo preparado.</p>
        )}
      </div>
    );
  }

  const { livro, audio, status, dono } = estado;
  const faltando = status.pendentes + status.gerando;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      {dono && <div className="mb-6"><Etapas atual={3} /></div>}
      <h1 className="font-serif text-3xl leading-tight sm:text-4xl">{livro.titulo}</h1>
      {livro.subtitulo && <p className="mt-1 font-serif text-lg italic text-tinta-suave">{livro.subtitulo}</p>}
      <p className="mt-2 text-tinta-suave">{livro.autor}</p>

      {livro.cortado && (
        <p className="mt-4 rounded-md border border-latao/40 bg-latao-claro/40 px-3 py-2 text-sm">
          O manuscrito passou do limite da demonstração ({estado.limite_caracteres.toLocaleString("pt-BR")} caracteres). Entraram só os primeiros capítulos.
        </p>
      )}

      {aviso && <p role="alert" className="mt-4 rounded-md border border-erro/30 bg-folha px-3 py-2 text-sm text-erro">{aviso}</p>}

      {!audio ? (
        dono ? (
          <Preparo estado={estado} onComecar={comecar} />
        ) : (
          <p className="mt-8 text-tinta-suave">A narração deste livro ainda não começou.</p>
        )
      ) : (
        <>
          <Andamento status={status} narrando={narrando} />
          {dono && !narrando && faltando > 0 && (
            <button onClick={continuar} className="mt-4 rounded-md bg-tinta px-4 py-2 text-folha hover:bg-tinta/90">
              Continuar a narração
            </button>
          )}
          {narrando && (
            <p className="mt-3 text-sm text-tinta-suave">Mantenha esta página aberta: a narração anda enquanto ela está aberta.</p>
          )}

          <ul className="mt-8 space-y-3">
            {audio.capitulos.filter((c) => c.trechos > 0).map((c) => (
              <Capitulo
                key={c.index}
                id={id}
                cap={c}
                aberto={aberto === c.index}
                onAlternar={() => setAberto(aberto === c.index ? null : c.index)}
                dono={dono}
                cabecalhos={cabecalhos}
                versao={versaoTrechos}
                aposMudanca={() => {
                  void carregar();
                  setNarrando(true);
                }}
                restantes={audio.regeneracoes_limite - audio.regeneracoes_usadas}
              />
            ))}
          </ul>

          {status.terminado && <Baixar id={id} />}
        </>
      )}
    </div>
  );
}

// ─── Antes de narrar: capítulos, voz e pronúncia ───────────────────────────

function Preparo({ estado, onComecar }: { estado: Estado; onComecar: (voz: string, p: Pronuncia[]) => Promise<void> }) {
  const [voz, setVoz] = useState<string | null>(null);
  const [falas, setFalas] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const capitulos = estado.previa.capitulos.filter((c) => c.index >= 0);

  return (
    <div className="mt-8 space-y-10">
      <section aria-labelledby="caps">
        <h2 id="caps" className="font-serif text-2xl">Capítulos encontrados</h2>
        <p className="mt-1 text-sm text-tinta-suave">
          {capitulos.length} {capitulos.length === 1 ? "capítulo" : "capítulos"}, {estado.previa.caracteres.toLocaleString("pt-BR")} caracteres
          (cerca de {Math.max(1, Math.round(estado.previa.caracteres / 951))} min de áudio), com créditos de abertura e de encerramento.
        </p>
        <ol className="mt-3 divide-y divide-linha rounded-lg border border-linha bg-folha">
          {capitulos.map((c) => (
            <li key={c.index} className="flex items-baseline justify-between gap-4 px-4 py-2">
              <span className="font-serif">{nomeSegmento(c.titulo)}</span>
              <span className="shrink-0 text-xs text-tinta-suave">
                {c.trechos > 0 ? `${c.caracteres.toLocaleString("pt-BR")} caracteres` : "só título, não é narrado"}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="voz">
        <h2 id="voz" className="font-serif text-2xl">Voz</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {estado.vozes.map((v) => (
            <EscolhaVoz key={v.id} voz={v} escolhida={voz === v.id} onEscolher={() => setVoz(v.id)} />
          ))}
        </div>
      </section>

      {estado.nomes.length > 0 && (
        <section aria-labelledby="pron">
          <h2 id="pron" className="font-serif text-2xl">Pronúncia dos nomes</h2>
          <p className="mt-1 text-sm text-tinta-suave">
            Se algum nome deve soar diferente de como se escreve, escreva como se fala (por exemplo, Siobhan como Xivón). Deixe em branco o que já está certo.
          </p>
          <ul className="mt-3 space-y-2">
            {estado.nomes.map((n) => (
              <li key={n.nome} className="grid grid-cols-[1fr_1fr] items-center gap-3">
                <span className="font-serif">{n.nome}</span>
                <input
                  aria-label={`Como se fala ${n.nome}`}
                  value={falas[n.nome] ?? ""}
                  onChange={(e) => setFalas({ ...falas, [n.nome]: e.target.value })}
                  maxLength={80}
                  className="rounded-md border border-linha bg-folha px-3 py-1.5"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <button
        disabled={!voz || ocupado}
        onClick={async () => {
          if (!voz) return;
          setOcupado(true);
          const pronuncias = Object.entries(falas)
            .map(([grafia, fala]) => ({ grafia, fala: fala.trim() }))
            .filter((p) => p.fala && p.fala !== p.grafia);
          await onComecar(voz, pronuncias);
          setOcupado(false);
        }}
        className="w-full rounded-md bg-tinta px-4 py-3 font-medium text-folha hover:bg-tinta/90 disabled:opacity-50"
      >
        {ocupado ? "Preparando…" : voz ? "Narrar o livro" : "Escolha uma voz para narrar"}
      </button>
    </div>
  );
}

function EscolhaVoz({ voz, escolhida, onEscolher }: { voz: Voz; escolhida: boolean; onEscolher: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [falha, setFalha] = useState(false);

  async function ouvir() {
    setCarregando(true);
    setFalha(false);
    const res = await fetch(`/api/vozes/${voz.id}`).catch(() => null);
    const json = res ? await res.json().catch(() => null) : null;
    setCarregando(false);
    if (json?.url) setUrl(json.url);
    else setFalha(true);
  }

  return (
    <div className={`rounded-lg border bg-folha p-4 ${escolhida ? "border-tinta ring-1 ring-tinta" : "border-linha"}`}>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="radio" name="voz" checked={escolhida} onChange={onEscolher} className="mt-1 accent-[var(--tinta)]" />
        <span>
          <span className="block font-medium">{voz.nome}</span>
          <span className="block text-sm text-tinta-suave">{voz.descricao}</span>
        </span>
      </label>
      <div className="mt-3">
        {url ? (
          <audio controls autoPlay src={url} className="h-9 w-full" />
        ) : (
          <button onClick={ouvir} disabled={carregando} className="text-sm underline disabled:opacity-60">
            {carregando ? "Preparando a amostra…" : "Ouvir amostra"}
          </button>
        )}
        {falha && <p className="mt-1 text-xs text-erro">A amostra não saiu agora. Tente de novo em instantes.</p>}
      </div>
    </div>
  );
}

// ─── Durante e depois ───────────────────────────────────────────────────────

function Andamento({ status, narrando }: { status: Status; narrando: boolean }) {
  const pct = status.total ? Math.round((status.prontos / status.total) * 100) : 0;
  const texto = status.terminado
    ? "Audiolivro pronto."
    : narrando
      ? `Narrando: ${status.prontos} de ${status.total} trechos`
      : `${status.prontos} de ${status.total} trechos narrados`;
  return (
    <section className="mt-8" aria-live="polite">
      <div className="flex items-baseline justify-between">
        <p className="font-medium">{texto}</p>
        <p className="text-sm text-tinta-suave">{status.capitulos_montados} de {status.capitulos} arquivos montados</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-linha" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-latao transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
      {(status.com_aviso > 0 || status.falhos > 0) && (
        <p className="mt-2 text-sm text-tinta-suave">
          {status.com_aviso > 0 && `${status.com_aviso} trecho(s) com aviso para conferir. `}
          {status.falhos > 0 && `${status.falhos} trecho(s) não saíram; abra o capítulo para refazer.`}
        </p>
      )}
    </section>
  );
}

function Capitulo(props: {
  id: string;
  cap: CapAudio;
  aberto: boolean;
  onAlternar: () => void;
  dono: boolean;
  cabecalhos: (json?: boolean) => HeadersInit;
  versao: number;
  aposMudanca: () => void;
  restantes: number;
}) {
  const { id, cap, aberto, onAlternar, versao } = props;
  const [trechos, setTrechos] = useState<Trecho[] | null>(null);

  useEffect(() => {
    let ativo = true;
    (async () => {
      const res = await fetch(`/api/livros/${id}/trechos?capitulo=${cap.index}`, { cache: "no-store" }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (ativo && json?.trechos) setTrechos(json.trechos as Trecho[]);
    })();
    return () => {
      ativo = false;
    };
  }, [id, cap.index, versao]);

  const prontos = trechos?.filter((t) => t.estado === "pronto").length ?? 0;
  const atencao = trechos?.some((t) => t.estado === "falhou" || t.avisos.length > 0) ?? false;

  return (
    <li className="rounded-lg border border-linha bg-folha">
      <div className="px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-serif text-lg">{nomeSegmento(cap.titulo)}</p>
          <p className="shrink-0 text-sm text-tinta-suave">{cap.duracao_ms ? minutos(cap.duracao_ms) : `${prontos}/${cap.trechos}`}</p>
        </div>
        {/* A fita do capítulo: um segmento por trecho, que acende quando é narrado. */}
        <div className="mt-2 flex gap-[3px]" aria-hidden>
          {(trechos ?? Array.from({ length: cap.trechos }, () => null)).map((t, i) => (
            <span
              key={t?.id ?? i}
              className={`h-1.5 flex-1 rounded-sm ${
                !t ? "bg-linha"
                  : t.estado === "pronto" ? (t.avisos.length ? "bg-latao/50" : "bg-latao")
                    : t.estado === "falhou" ? "bg-erro"
                      : t.estado === "gerando" ? "animate-pulse bg-latao-claro"
                        : "bg-linha"
              }`}
            />
          ))}
        </div>
        {cap.url && <audio controls preload="none" src={cap.url} className="mt-3 h-9 w-full" />}
        <button onClick={onAlternar} aria-expanded={aberto} className="mt-2 text-sm underline">
          {aberto ? "Fechar trechos" : atencao ? "Conferir trechos (há avisos)" : "Ver trechos"}
        </button>
      </div>
      {aberto && trechos && (
        <ol className="divide-y divide-linha border-t border-linha">
          {trechos.map((t) => (
            <LinhaTrecho key={t.id} {...props} trecho={t} />
          ))}
        </ol>
      )}
    </li>
  );
}

function LinhaTrecho({ id, trecho, dono, cabecalhos, aposMudanca, restantes }: {
  id: string;
  trecho: Trecho;
  dono: boolean;
  cabecalhos: (json?: boolean) => HeadersInit;
  aposMudanca: () => void;
  restantes: number;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(trecho.texto_fala);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const livre = trecho.estado === "pronto" || trecho.estado === "falhou";

  async function agir(acao: "refazer" | "editar" | "restaurar") {
    setOcupado(true);
    setErro(null);
    const res = await fetch(`/api/livros/${id}/trechos/${trecho.id}`, {
      method: "POST",
      headers: cabecalhos(true),
      body: JSON.stringify({ acao, texto }),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setOcupado(false);
    if (!res?.ok) {
      setErro(json.error ?? "Não foi possível agora.");
      return;
    }
    setEditando(false);
    aposMudanca();
  }

  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-serif">Trecho {trecho.ordem + 1}{trecho.editado ? " (fala editada)" : ""}</p>
        <p className="shrink-0 text-xs text-tinta-suave">
          {trecho.estado === "pronto" ? minutos(trecho.duracao_ms) : trecho.estado === "falhou" ? "não saiu" : "na fila"}
        </p>
      </div>
      <p className="mt-1 font-serif text-tinta-suave">{trecho.inicio}…</p>
      {trecho.avisos.length > 0 && (
        <p className="mt-1 text-xs text-latao">{trecho.avisos.map((a) => AVISOS[a] ?? a).join(". ")}.</p>
      )}
      {trecho.url && <audio controls preload="none" src={trecho.url} className="mt-2 h-8 w-full" />}

      {dono && livre && !editando && (
        <div className="mt-2 flex flex-wrap gap-4">
          <button onClick={() => agir("refazer")} disabled={ocupado} className="underline disabled:opacity-60">Narrar de novo</button>
          <button onClick={() => setEditando(true)} className="underline">Editar a fala</button>
          {trecho.editado && <button onClick={() => agir("restaurar")} disabled={ocupado} className="underline disabled:opacity-60">Voltar ao texto do livro</button>}
          {trecho.estado === "pronto" && <span className="text-xs text-tinta-suave">{restantes} regenerações restantes neste livro</span>}
        </div>
      )}
      {editando && (
        <div className="mt-2">
          <label htmlFor={`fala-${trecho.id}`} className="text-xs text-tinta-suave">
            O que a voz fala neste trecho. Ajuste palavras (uma pronúncia, uma pausa); o texto do livro não muda.
          </label>
          <textarea
            id={`fala-${trecho.id}`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={6}
            className="mt-1 w-full rounded-md border border-linha bg-papel p-2 font-serif"
          />
          <div className="mt-2 flex gap-4">
            <button onClick={() => agir("editar")} disabled={ocupado} className="rounded-md bg-tinta px-3 py-1.5 text-folha disabled:opacity-60">
              {ocupado ? "Salvando…" : "Salvar e narrar de novo"}
            </button>
            <button onClick={() => { setEditando(false); setTexto(trecho.texto_fala); }} className="underline">Cancelar</button>
          </div>
        </div>
      )}
      {erro && <p role="alert" className="mt-1 text-xs text-erro">{erro}</p>}
    </li>
  );
}

function Baixar({ id }: { id: string }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <section className="mt-10 rounded-lg border border-tinta bg-folha p-5">
      <h2 className="font-serif text-2xl">Audiolivro pronto</h2>
      <p className="mt-1 text-sm text-tinta-suave">Um MP3 por capítulo, numerados na ordem em que o livro toca, com os créditos nas pontas.</p>
      <button
        disabled={ocupado}
        onClick={async () => {
          setOcupado(true);
          setErro(null);
          const res = await fetch(`/api/livros/${id}/zip`, { method: "POST" }).catch(() => null);
          const json = res ? await res.json().catch(() => null) : null;
          setOcupado(false);
          if (json?.url) window.location.href = json.url;
          else setErro(json?.error ?? "Não foi possível preparar o ZIP agora.");
        }}
        className="mt-4 rounded-md bg-tinta px-4 py-2 text-folha hover:bg-tinta/90 disabled:opacity-60"
      >
        {ocupado ? "Juntando os arquivos…" : "Baixar o ZIP"}
      </button>
      {erro && <p role="alert" className="mt-2 text-sm text-erro">{erro}</p>}
    </section>
  );
}
