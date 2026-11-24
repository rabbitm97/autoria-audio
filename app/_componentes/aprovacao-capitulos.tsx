"use client";

// Etapa Capítulos: o autor confere a proposta, marca o que é capítulo,
// renomeia, acha pela busca o que faltou, edita o texto de cada capítulo e da
// abertura (o que vem antes do 1º capítulo) e decide para onde vai um pedaço
// que ele apagar: capítulo novo, capítulo anterior ou seguinte. Nada é
// narrado sem a confirmação dele.
// Mesmo comportamento da conferência de capítulos da Autoria, escrito de novo
// para a demonstração.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CandidatoCapitulo, OrigemCandidato } from "@/lib/adaptadores/tipos";

// ─── Textos e utilitários ───────────────────────────────────────────────────

const ROTULO_ORIGEM: Record<OrigemCandidato, string> = {
  marcador_explicito: "Capítulo explícito",
  marcador_divisor: "Entre divisores",
  secao_nomeada: "Seção nomeada",
  markdown_heading: "Título Markdown",
  all_caps_isolado: "Maiúsculas, isolada",
  numero_isolado: "Número isolado",
  linha_curta_isolada: "Linha curta isolada",
  estilo_word: "Título do Word",
  manual: "Adicionado por você",
};

const contarPalavras = (s: string) => s.split(/\s+/).filter(Boolean).length;
const milhar = (n: number) => n.toLocaleString("pt-BR");

/**
 * O que mudou no meio do texto: o que saiu, o que entrou e onde. Quando a
 * mudança passa de um parágrafo, ela é alargada até o começo das linhas,
 * para o pedaço guardado sair com os parágrafos inteiros.
 */
function diferenca(antes: string, depois: string) {
  let ini = 0;
  while (ini < antes.length && ini < depois.length && antes[ini] === depois[ini]) ini++;
  let fim = 0;
  while (fim < antes.length - ini && fim < depois.length - ini && antes[antes.length - 1 - fim] === depois[depois.length - 1 - fim]) fim++;
  const varias = antes.slice(ini, antes.length - fim).includes("\n") || depois.slice(ini, depois.length - fim).includes("\n");
  const noMeioDaLinha = (t: string, i: number) => i > 0 && i < t.length && t[i - 1] !== "\n" && t[i] !== "\n";
  if (varias) {
    if (noMeioDaLinha(antes, ini)) ini = antes.lastIndexOf("\n", ini - 1) + 1;
    const corte = antes.length - fim;
    if (noMeioDaLinha(antes, corte)) {
      const linha = antes.lastIndexOf("\n", corte - 1) + 1;
      const k = corte - linha;
      const cabe = linha >= ini && depois.length - fim - k >= ini;
      if (cabe && antes.slice(linha, corte) === depois.slice(depois.length - fim - k, depois.length - fim)) fim += k;
    }
  }
  return {
    saiu: antes.slice(ini, antes.length - fim),
    entrou: depois.slice(ini, depois.length - fim),
    noInicio: ini <= 2,
    noFim: fim <= 2,
  };
}

interface Ocorrencia {
  pos: number;
  linha: string;
  contexto_antes: string;
  contexto_depois: string;
  alinhada_a_linha: boolean;
}

interface Edicao {
  /** id do candidato, ou "abertura". */
  alvo: string;
  carregando: boolean;
  salvando: boolean;
  texto: string;
  original: string;
  start: number;
  end: number;
  hash: string;
  tituloLinha: string | null;
  posTitulo: number | null;
  erro: string | null;
}

interface Destino {
  saiu: string;
  saldo: number;
  noInicio: boolean;
  noFim: boolean;
  criando: boolean;
  tituloNovo: string;
}

type Resposta = { http: number; json: Record<string, unknown> & { error?: string } };

// ─── Componente ─────────────────────────────────────────────────────────────

export default function AprovacaoCapitulos({
  id,
  token,
  onAprovado,
}: {
  id: string;
  token: string;
  onAprovado: () => void;
}) {
  const [lista, setLista] = useState<CandidatoCapitulo[] | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [titulos, setTitulos] = useState<Record<string, string>>({});
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [verDescartados, setVerDescartados] = useState(false);
  const [arbitragem, setArbitragem] = useState<"ok" | "indisponivel" | "nao_necessaria">("nao_necessaria");
  const [reidratado, setReidratado] = useState(false);
  const [incluirAbertura, setIncluirAbertura] = useState(true);
  const [limite, setLimite] = useState<number | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);

  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [destino, setDestino] = useState<Destino | null>(null);
  const [salvo, setSalvo] = useState<number | null>(null);

  const [termo, setTermo] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);

  const [aprovando, setAprovando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const chamar = useCallback(
    async (corpo?: Record<string, unknown>): Promise<Resposta> => {
      try {
        const res = await fetch(`/api/livros/${id}/capitulos`, corpo
          ? { method: "POST", headers: { "x-livro-token": token, "Content-Type": "application/json" }, body: JSON.stringify(corpo) }
          : { headers: { "x-livro-token": token }, cache: "no-store" });
        return { http: res.status, json: await res.json().catch(() => ({})) };
      } catch {
        return { http: 0, json: { error: "Erro de rede. Confira a conexão e tente de novo." } };
      }
    },
    [id, token],
  );

  const carregar = useCallback(async () => {
    const { http, json } = await chamar();
    if (http !== 200 || !Array.isArray(json.candidatos)) {
      setErroCarga(json.error ?? "Não foi possível carregar os capítulos.");
      return;
    }
    const cands = json.candidatos as CandidatoCapitulo[];
    setLista(cands);
    setMarcados(new Set(cands.filter((c) => c.sugerido).map((c) => c.id)));
    setTitulos(Object.fromEntries(cands.map((c) => [c.id, c.titulo])));
    setArbitragem((json.arbitragem as typeof arbitragem) ?? "nao_necessaria");
    setReidratado(json.reidratado === true);
    setIncluirAbertura(json.incluir_abertura !== false);
    setLimite(typeof json.limite_caracteres === "number" ? json.limite_caracteres : null);
    setErroCarga(null);
  }, [chamar]);

  useEffect(() => {
    queueMicrotask(() => void carregar());
  }, [carregar]);

  const ordenados = useMemo(() => [...(lista ?? [])].sort((a, b) => a.pos - b.pos), [lista]);
  const sugeridos = ordenados.filter((c) => marcados.has(c.id) || c.sugerido);
  const descartados = ordenados.filter((c) => !marcados.has(c.id) && !c.sugerido);
  const escolhidos = ordenados.filter((c) => marcados.has(c.id));
  const primeiro = escolhidos[0] ?? null;
  const temAbertura = !!primeiro && primeiro.pos > 0;

  // Um capítulo 15 vezes maior que a mediana pode esconder capítulos não achados.
  const desequilibrado = useMemo(() => {
    const p = escolhidos.map((c) => c.palavras_no_segmento).filter((n) => n > 0).sort((a, b) => a - b);
    if (escolhidos.length < 3 || p.length < 3) return false;
    const mediana = p[Math.floor(p.length / 2)];
    return mediana > 0 && p[p.length - 1] > mediana * 15;
  }, [escolhidos]);

  /** O que está marcado agora, com os títulos da tela (vai junto em cada gravação). */
  const decisoes = () => escolhidos.map((c) => ({ titulo: (titulos[c.id] ?? c.titulo).trim() || c.titulo, pos: c.pos }));

  function alternar<T>(conjunto: Set<T>, item: T): Set<T> {
    const n = new Set(conjunto);
    if (n.has(item)) n.delete(item);
    else n.add(item);
    return n;
  }

  // ─── Busca ────────────────────────────────────────────────────────────────

  async function buscar() {
    const q = termo.trim();
    if (q.length < 3) { setErroBusca("Digite pelo menos 3 caracteres."); return; }
    setErroBusca(null);
    setBuscando(true);
    setOcorrencias([]);
    const { http, json } = await chamar({ acao: "buscar", termo: q });
    setBuscando(false);
    if (http !== 200) { setErroBusca(json.error ?? "Erro ao buscar no texto."); return; }
    const achadas = (json.ocorrencias ?? []) as Ocorrencia[];
    if (achadas.length === 0) { setErroBusca("Não encontrei essa linha no texto — confira se está igual ao arquivo."); return; }
    setOcorrencias(achadas);
  }

  function marcarAqui(oc: Ocorrencia) {
    const perto = (lista ?? []).find((c) => Math.abs(c.pos - oc.pos) <= 5);
    if (perto) {
      setMarcados((m) => new Set(m).add(perto.id));
    } else {
      const novo: CandidatoCapitulo = {
        id: `manual-${oc.pos}-${(lista ?? []).length}`,
        titulo: termo.trim(),
        pos: oc.pos,
        origem: "manual",
        score: 1,
        sugerido: true,
        preview_antes: oc.contexto_antes,
        preview_depois: oc.contexto_depois,
        palavras_no_segmento: 0,
      };
      setLista((l) => [...(l ?? []), novo]);
      setTitulos((t) => ({ ...t, [novo.id]: novo.titulo }));
      setMarcados((m) => new Set(m).add(novo.id));
    }
    setOcorrencias([]);
    setTermo("");
  }

  // ─── Edição do texto ──────────────────────────────────────────────────────

  async function abrirEdicao(alvo: string) {
    setSalvo(null);
    const vazia: Edicao = { alvo, carregando: true, salvando: false, texto: "", original: "", start: 0, end: 0, hash: "", tituloLinha: null, posTitulo: null, erro: null };
    setEdicao(vazia);
    let pedido: Record<string, unknown>;
    if (alvo === "abertura") {
      if (!primeiro) return;
      pedido = { acao: "abertura", fim: primeiro.pos };
    } else {
      const c = ordenados.find((x) => x.id === alvo);
      if (!c) return;
      const seguinte = escolhidos.find((x) => x.pos > c.pos);
      pedido = { acao: "segmento", pos: c.pos, fim: seguinte ? seguinte.pos : null };
    }
    const { http, json } = await chamar(pedido);
    if (http !== 200) { setEdicao({ ...vazia, carregando: false, erro: json.error ?? "Erro ao carregar o trecho." }); return; }
    const texto = String(json.texto_segmento ?? "");
    setEdicao({
      ...vazia,
      carregando: false,
      texto,
      original: texto,
      start: Number(json.start),
      end: Number(json.end),
      hash: String(json.hash_atual),
      tituloLinha: (json.titulo_linha as string | null) ?? (alvo === "abertura" ? null : titulos[alvo] ?? null),
      posTitulo: (json.pos_titulo as number | null) ?? null,
    });
  }

  function fecharEdicao() {
    setEdicao(null);
    setDestino(null);
  }

  function pedirSalvar() {
    if (!edicao) return;
    const d = diferenca(edicao.original, edicao.texto);
    const saldo = contarPalavras(d.saiu) - contarPalavras(d.entrou);
    if (edicao.alvo === "abertura") {
      if (!edicao.texto.trim()) {
        setEdicao({ ...edicao, erro: "A abertura não pode ficar vazia. Para não narrá-la, desmarque “Narrar a abertura” — o texto fica guardado." });
        return;
      }
      if (saldo >= 30 && !window.confirm(`Você está apagando ${saldo} palavras da abertura. Para não narrá-la sem apagar o texto, desmarque “Narrar a abertura”. Apagar mesmo assim?`)) return;
      void salvar();
      return;
    }
    // Apagou 30 palavras ou mais: perguntar para onde vai o pedaço.
    if (saldo >= 30) {
      setDestino({ saiu: d.saiu, saldo, noInicio: d.noInicio, noFim: d.noFim, criando: false, tituloNovo: "Novo capítulo" });
      return;
    }
    void salvar();
  }

  async function salvar(opcao?: { destino: "novo" | "anterior" | "seguinte"; trecho: string; titulo?: string }) {
    if (!edicao) return;
    setDestino(null);
    setEdicao({ ...edicao, salvando: true, erro: null });
    const antes = contarPalavras(edicao.original);
    const delta = contarPalavras(edicao.texto) + (opcao ? contarPalavras(opcao.trecho) : 0) - antes;
    const { http, json } = await chamar({
      acao: "salvar_segmento",
      start: edicao.start,
      end: edicao.end,
      texto_novo: edicao.texto,
      hash_atual: edicao.hash,
      abertura: edicao.alvo === "abertura",
      marcados: decisoes(),
      ...(opcao
        ? {
            destino_trecho: opcao.destino,
            trecho: opcao.trecho,
            ...(opcao.destino === "novo" ? { capitulo_novo_titulo: opcao.titulo } : {}),
            ...(opcao.destino === "anterior" && edicao.posTitulo !== null ? { pos_titulo: edicao.posTitulo } : {}),
          }
        : {}),
    });
    if (http === 409) {
      setEdicao({ ...edicao, salvando: false, erro: json.error ?? "O texto mudou. Recarregue a conferência." });
      return;
    }
    if (http !== 200) {
      setEdicao({ ...edicao, salvando: false, erro: json.error ?? "Não foi possível salvar agora." });
      return;
    }
    const usado = opcao?.destino ?? "substituir";
    const esvaziou = edicao.texto.trim() === "" && usado !== "substituir";
    if (usado === "anterior" || usado === "seguinte" || esvaziou) {
      // As posições mudaram de um jeito que só o servidor sabe: recarrega
      // (as decisões da tela foram gravadas junto e voltam marcadas).
      fecharEdicao();
      setSalvo(delta);
      await carregar();
      return;
    }
    const dAntes = Number(json.delta_antes_de_s ?? 0);
    const dDepois = Number(json.delta_apos_e ?? 0);
    const { start, end, posTitulo } = edicao;
    const mover = (pos: number) =>
      pos < start ? (posTitulo !== null && pos >= posTitulo ? pos + dAntes : pos) : pos >= end ? pos + dDepois : pos;
    const movidos = (lista ?? []).map((c) => ({ ...c, pos: mover(c.pos) }));
    if (json.capitulo_novo_pos !== undefined && opcao?.titulo) {
      const novo: CandidatoCapitulo = {
        id: `manual-${Number(json.capitulo_novo_pos)}-${movidos.length}`,
        titulo: opcao.titulo,
        pos: Number(json.capitulo_novo_pos),
        origem: "manual",
        score: 1,
        sugerido: true,
        preview_antes: "",
        preview_depois: "",
        palavras_no_segmento: 0,
      };
      movidos.push(novo);
      setTitulos((t) => ({ ...t, [novo.id]: novo.titulo }));
      setMarcados((m) => new Set(m).add(novo.id));
    }
    setLista(movidos);
    fecharEdicao();
    setSalvo(delta);
  }

  // ─── Ações gerais ─────────────────────────────────────────────────────────

  async function recomecar() {
    if (!window.confirm("Isso apaga as suas escolhas de capítulos e refaz a proposta sobre o texto atual. O texto do livro não muda. Continuar?")) return;
    const { http } = await chamar({ acao: "recomecar" });
    if (http === 200) await carregar();
  }

  async function confirmar() {
    const capitulos = escolhidos
      .map((c) => ({ titulo: (titulos[c.id] ?? c.titulo).trim(), pos: c.pos }))
      .filter((c) => c.titulo.length > 0);
    setErro(null);
    setAprovando(true);
    const { http, json } = await chamar({ acao: "aprovar", capitulos, incluir_abertura: incluirAbertura });
    if (http !== 200) {
      setErro(json.error ?? "Falha ao aprovar os capítulos.");
      setAprovando(false);
      return;
    }
    onAprovado();
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (!lista) {
    return (
      <p className={`mt-6 ${erroCarga ? "text-erro" : "text-tinta-suave"}`} aria-live="polite">
        {erroCarga ?? "Detectando os capítulos…"}
      </p>
    );
  }

  const editorDe = (alvo: string) =>
    edicao?.alvo === alvo ? (
      <CaixaEdicao
        edicao={edicao}
        abertura={alvo === "abertura"}
        onTexto={(texto) => setEdicao({ ...edicao, texto })}
        onSalvar={pedirSalvar}
        onCancelar={fecharEdicao}
        onRecarregar={() => { fecharEdicao(); void carregar(); }}
      />
    ) : null;

  const cartao = (c: CandidatoCapitulo) => (
    <Cartao
      key={c.id}
      c={c}
      marcado={marcados.has(c.id)}
      titulo={titulos[c.id] ?? c.titulo}
      inicioAberto={abertos.has(c.id)}
      onMarcar={() => setMarcados((m) => alternar(m, c.id))}
      onTitulo={(t) => setTitulos((x) => ({ ...x, [c.id]: t }))}
      onInicio={() => setAbertos((a) => alternar(a, c.id))}
      editor={editorDe(c.id)}
      onEditar={edicao ? undefined : () => void abrirEdicao(c.id)}
    />
  );

  const marcadosOrdem = escolhidos;
  const idxEditando = edicao ? marcadosOrdem.findIndex((c) => c.id === edicao.alvo) : -1;
  const seguinteDoEditado = idxEditando >= 0 ? marcadosOrdem[idxEditando + 1] ?? null : null;

  return (
    <div className="mt-6 space-y-4">
      <div>
        <h2 className="font-serif text-2xl text-tinta">Capítulos detectados</h2>
        <p className="mt-1 text-sm text-tinta-suave">
          Cada capítulo vira um arquivo de áudio. A detecção propõe, a IA confere, e quem decide é você.
        </p>
      </div>

      <div className="rounded-lg border border-linha bg-papel px-4 py-3 text-sm leading-relaxed text-tinta">
        Marque o que é capítulo de verdade. Desmarcar junta o trecho ao capítulo anterior; se faltou algum, adicione pela busca lá embaixo. Você também pode editar o texto de cada capítulo e da abertura. Nada é narrado sem a sua confirmação.
      </div>

      {arbitragem === "indisponivel" && (
        <p className="rounded-lg border border-latao/40 bg-latao-claro/40 px-4 py-2 text-xs text-tinta">
          A conferência por IA está indisponível agora — a proposta abaixo vem só dos padrões do texto.
        </p>
      )}
      {reidratado && (
        <p className="rounded-lg border border-linha bg-papel px-4 py-2 text-xs text-tinta-suave">Mostrando os capítulos como você deixou da última vez.</p>
      )}
      {salvo !== null && (
        <p role="status" className="rounded-lg border border-linha bg-papel px-4 py-2 text-xs text-tinta">
          Texto salvo.{salvo !== 0 ? ` (${salvo > 0 ? "+" : "−"}${milhar(Math.abs(salvo))} palavras)` : ""}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-y border-linha py-3">
        <button type="button" onClick={() => setMarcados(new Set(lista.filter((c) => c.sugerido).map((c) => c.id)))} className="rounded border border-linha px-3 py-1.5 text-xs hover:bg-papel">
          Marcar sugeridos
        </button>
        <button type="button" onClick={() => setMarcados(new Set(lista.map((c) => c.id)))} className="rounded border border-linha px-3 py-1.5 text-xs hover:bg-papel">
          Marcar todos
        </button>
        <button type="button" onClick={() => setMarcados(new Set())} className="rounded border border-linha px-3 py-1.5 text-xs hover:bg-papel">
          Limpar
        </button>
        <button type="button" onClick={() => void recomecar()} className="rounded border border-erro/30 px-3 py-1.5 text-xs text-erro hover:bg-erro/5">
          Recomeçar do zero
        </button>
        <p className="ml-auto text-sm text-tinta-suave">
          <strong className="text-tinta">{marcados.size}</strong> de {lista.length} selecionados
        </p>
      </div>

      {/* Abertura: o texto antes do 1º capítulo marcado. */}
      {temAbertura && (
        <div className="rounded-lg border border-linha bg-folha px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-serif text-tinta">Abertura</p>
              <p className="text-xs text-tinta-suave">O texto que vem antes de “{titulos[primeiro.id] ?? primeiro.titulo}”: folha de rosto, dedicatória, epígrafe, prefácio sem título.</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-tinta">
              <input type="checkbox" checked={incluirAbertura} onChange={(e) => setIncluirAbertura(e.target.checked)} className="h-4 w-4 accent-[var(--tinta)]" />
              Narrar a abertura
            </label>
          </div>
          {!incluirAbertura && <p className="mt-1 text-xs text-tinta-suave">A abertura não vai ser narrada. O texto continua guardado.</p>}
          <div className="mt-2">
            {editorDe("abertura") ?? (
              <button type="button" onClick={() => void abrirEdicao("abertura")} disabled={!!edicao} className="text-xs text-tinta-suave underline underline-offset-2 hover:text-tinta disabled:opacity-50">
                ver e editar o texto da abertura
              </button>
            )}
          </div>
        </div>
      )}

      <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-linha bg-folha">
        {ordenados.length === 0 && <p className="p-6 text-center text-sm text-tinta-suave">Nenhum candidato a capítulo neste texto. Use a busca para marcar onde cada capítulo começa.</p>}
        {ordenados.length > 0 && sugeridos.length === 0 && (
          <p className="p-6 text-center text-sm text-tinta-suave">Nenhum capítulo sugerido pela análise — confira os descartados abaixo.</p>
        )}
        {sugeridos.map(cartao)}
      </div>

      {descartados.length > 0 && (
        <div className="rounded-lg border border-linha bg-folha">
          <button type="button" onClick={() => setVerDescartados((v) => !v)} aria-expanded={verDescartados} className="flex w-full items-center justify-between px-4 py-3 text-left">
            <span className="text-sm font-medium text-tinta-suave">Descartados pela análise ({descartados.length})</span>
            <span className="text-tinta-suave" aria-hidden>{verDescartados ? "▴" : "▾"}</span>
          </button>
          {verDescartados ? (
            <div className="max-h-[40vh] overflow-y-auto border-t border-linha">{descartados.map(cartao)}</div>
          ) : (
            <p className="px-4 pb-3 text-xs text-tinta-suave">Provavelmente sumário, cabeçalhos de página ou trechos curtos — abra para conferir e marcar se algum for capítulo de verdade.</p>
          )}
        </div>
      )}

      <div className="space-y-3 rounded-lg border border-linha bg-folha p-4">
        <label htmlFor="busca-capitulo" className="block text-sm font-medium text-tinta">
          Faltou um capítulo? Digite o título exatamente como está no arquivo
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="busca-capitulo"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void buscar(); } }}
            placeholder="Ex.: O Encontro"
            className="min-w-0 flex-1 rounded border border-linha bg-folha px-3 py-2 text-sm"
          />
          <button type="button" onClick={() => void buscar()} disabled={buscando || termo.trim().length < 3} className="rounded border border-linha px-4 py-2 text-xs hover:bg-papel disabled:opacity-50">
            {buscando ? "Buscando…" : "Buscar"}
          </button>
        </div>
        {erroBusca && <p className="text-xs text-erro">{erroBusca}</p>}
        {ocorrencias.length > 0 && (
          <div className="space-y-2 border-t border-linha pt-3">
            <p className="text-xs text-tinta-suave">
              {ocorrencias.length} ocorrência{ocorrencias.length > 1 ? "s" : ""} encontrada{ocorrencias.length > 1 ? "s" : ""}:
            </p>
            {ocorrencias.map((oc) => (
              <div key={oc.pos} className="rounded border border-linha bg-papel p-3 text-sm">
                <p className="font-medium text-tinta">{oc.linha}</p>
                {!oc.alinhada_a_linha && <p className="mt-1 text-xs italic text-ouro">Esse trecho está no meio de um parágrafo — o capítulo vai começar exatamente neste ponto.</p>}
                <div className="mt-1 grid gap-1 text-xs text-tinta-suave sm:grid-cols-2">
                  <p><span className="text-tinta-suave/80">…antes:</span> {oc.contexto_antes}</p>
                  <p><span className="text-tinta-suave/80">depois:</span> {oc.contexto_depois.slice(0, 160)}…</p>
                </div>
                <button type="button" onClick={() => marcarAqui(oc)} className="mt-2 rounded bg-tinta px-3 py-1 text-xs font-medium text-folha hover:bg-tinta/90">
                  É aqui
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {desequilibrado && (
        <p className="rounded-lg border border-latao/40 bg-latao-claro/40 px-4 py-3 text-sm text-tinta">
          Um dos capítulos ficou muito maior que os outros — pode existir capítulo não detectado dentro dele. Se faltar algum, use a busca acima.
        </p>
      )}

      {erro && <p role="alert" className="text-sm text-erro">{erro}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-linha pt-4">
        <Link href="/" className="text-sm text-tinta-suave underline hover:text-tinta">Enviar outro arquivo</Link>
        <button
          type="button"
          onClick={() => void confirmar()}
          disabled={aprovando || marcados.size === 0 || !!edicao}
          className="rounded-lg bg-tinta px-6 py-2.5 text-sm font-medium text-folha hover:bg-tinta/90 disabled:opacity-50"
        >
          {aprovando ? "Montando os capítulos…" : `Confirmar ${marcados.size} capítulo${marcados.size === 1 ? "" : "s"} e continuar`}
        </button>
      </div>
      {limite !== null && (
        <p className="text-xs text-tinta-suave">Nesta demonstração, a narração vai até {milhar(limite)} caracteres: se o livro passar disso, entram os primeiros capítulos.</p>
      )}

      {destino && edicao && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="destino-titulo" className="w-full max-w-lg space-y-4 rounded-xl bg-folha p-6">
            <h3 id="destino-titulo" className="font-serif text-lg text-tinta">Você tirou {milhar(destino.saldo)} palavras do livro</h3>
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-linha bg-papel px-3 py-2 font-mono text-xs leading-relaxed text-tinta">
              {destino.saiu.slice(0, 300)}{destino.saiu.length > 300 ? "…" : ""}
            </div>
            <p className="text-sm leading-relaxed text-tinta-suave">O texto apagado aqui sai do livro, não só deste capítulo. O que fazer com esse trecho?</p>
            {destino.criando ? (
              <div className="space-y-2">
                <label htmlFor="titulo-novo" className="block text-sm font-medium text-tinta">Título do novo capítulo</label>
                <input id="titulo-novo" value={destino.tituloNovo} onChange={(e) => setDestino({ ...destino, tituloNovo: e.target.value })} className="w-full rounded border border-linha px-3 py-2 text-sm" />
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={!destino.tituloNovo.trim()}
                    onClick={() => void salvar({ destino: "novo", trecho: destino.saiu, titulo: destino.tituloNovo.trim() })}
                    className="rounded bg-tinta px-4 py-2 text-xs font-medium text-folha disabled:opacity-50"
                  >
                    Confirmar
                  </button>
                  <button type="button" onClick={() => setDestino({ ...destino, criando: false })} className="rounded border border-linha px-4 py-2 text-xs">
                    Voltar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <button type="button" onClick={() => setDestino({ ...destino, criando: true })} className="w-full rounded border border-linha px-4 py-2 text-left text-sm hover:bg-papel">
                  Criar um capítulo com esse trecho
                </button>
                {destino.noInicio && idxEditando > 0 && (
                  <button type="button" onClick={() => void salvar({ destino: "anterior", trecho: destino.saiu })} className="w-full rounded border border-linha px-4 py-2 text-left text-sm hover:bg-papel">
                    Juntar ao fim do capítulo anterior
                  </button>
                )}
                {destino.noFim && seguinteDoEditado && seguinteDoEditado.origem !== "manual" && (
                  <button type="button" onClick={() => void salvar({ destino: "seguinte", trecho: destino.saiu })} className="w-full rounded border border-linha px-4 py-2 text-left text-sm hover:bg-papel">
                    Mover para o começo do capítulo seguinte
                  </button>
                )}
                <button type="button" onClick={() => void salvar()} className="w-full rounded border border-erro/30 bg-erro/5 px-4 py-2 text-left text-sm text-erro hover:bg-erro/10">
                  Apagar do livro
                </button>
                <button type="button" onClick={() => setDestino(null)} className="w-full rounded border border-linha px-4 py-2 text-left text-sm hover:bg-papel">
                  Cancelar
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Partes ─────────────────────────────────────────────────────────────────

function Cartao({
  c, marcado, titulo, inicioAberto, onMarcar, onTitulo, onInicio, editor, onEditar,
}: {
  c: CandidatoCapitulo;
  marcado: boolean;
  titulo: string;
  inicioAberto: boolean;
  onMarcar: () => void;
  onTitulo: (t: string) => void;
  onInicio: () => void;
  editor: React.ReactNode;
  onEditar?: () => void;
}) {
  const iaDuvida = !!c.arbitrado && !!c.motivo_ia && !c.ia_e_capitulo;
  return (
    <div className={`border-b border-linha px-4 py-3 last:border-b-0 ${marcado ? "bg-latao-claro/20" : ""}`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={marcado} onChange={onMarcar} aria-label={`Capítulo: ${titulo}`} className="mt-1.5 h-4 w-4 shrink-0 accent-[var(--tinta)]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={titulo}
              onChange={(e) => onTitulo(e.target.value)}
              disabled={!marcado}
              aria-label="Título do capítulo"
              className={`min-w-0 flex-1 basis-48 rounded border border-linha px-2 py-1 text-sm ${marcado ? "bg-folha text-tinta" : "bg-papel text-tinta-suave"}`}
            />
            <span className="rounded border border-linha bg-papel px-2 py-0.5 text-[11px] text-tinta-suave">{ROTULO_ORIGEM[c.origem]}</span>
            {c.arbitrado && c.motivo_ia && (
              <span className={`rounded border px-2 py-0.5 text-[11px] ${iaDuvida ? "border-latao/40 bg-latao-claro/50 text-tinta" : "border-linha bg-papel text-tinta-suave"}`}>
                IA: {c.motivo_ia}
              </span>
            )}
            <span className="text-[11px] text-tinta-suave">
              confiança {c.score.toFixed(2).replace(".", ",")} · ~{milhar(c.palavras_no_segmento)} palavras
            </span>
          </div>
          <div className="mt-2 grid gap-1 text-xs text-tinta-suave sm:grid-cols-2">
            <p className="break-words"><span className="text-tinta-suave/80">…antes:</span> {c.preview_antes}</p>
            <p className="break-words">
              <span className="text-tinta-suave/80">depois:</span> {c.preview_depois.slice(0, 120)}{c.preview_depois.length > 120 ? "…" : ""}
            </p>
          </div>
          {c.preview_depois.length > 120 && (
            <button type="button" onClick={onInicio} aria-expanded={inicioAberto} className="mt-2 text-xs text-tinta-suave underline underline-offset-2 hover:text-tinta">
              {inicioAberto ? "esconder" : "ver o início deste capítulo"}
            </button>
          )}
          {inicioAberto && (
            <p className="mt-2 whitespace-pre-wrap rounded-lg border border-linha bg-papel px-3 py-2 text-xs leading-relaxed text-tinta">{c.preview_depois}</p>
          )}
          {marcado && (
            <div className="mt-2">
              {editor ?? (
                <button type="button" onClick={onEditar} disabled={!onEditar} className="text-xs text-tinta-suave underline underline-offset-2 hover:text-tinta disabled:opacity-50">
                  editar o texto deste capítulo
                </button>
              )}
            </div>
          )}
          {!marcado && <p className="mt-1 text-xs italic text-tinta-suave">Este trecho passa a fazer parte do capítulo anterior.</p>}
          {c.motivo_descartado && (
            <p className="mt-1 text-xs italic text-tinta-suave">{marcado ? `A análise dizia: ${c.motivo_descartado}` : c.motivo_descartado}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function CaixaEdicao({
  edicao, abertura, onTexto, onSalvar, onCancelar, onRecarregar,
}: {
  edicao: Edicao;
  abertura: boolean;
  onTexto: (t: string) => void;
  onSalvar: () => void;
  onCancelar: () => void;
  onRecarregar: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-linha bg-folha p-3">
      <p className="text-xs leading-relaxed text-tinta-suave">
        Você está editando o texto do livro. Cada parágrafo fica numa linha, com uma linha em branco entre eles; falas de diálogo são parágrafos. O que você salvar aqui substitui este trecho no livro, e os capítulos se ajustam sozinhos.
      </p>
      {edicao.carregando ? (
        <p className="text-xs text-tinta-suave">Carregando…</p>
      ) : (
        <>
          {edicao.tituloLinha && <p className="text-xs font-medium text-tinta-suave">Editando: {edicao.tituloLinha}</p>}
          <textarea
            value={edicao.texto}
            onChange={(e) => onTexto(e.target.value)}
            disabled={edicao.salvando}
            rows={12}
            aria-label={abertura ? "Texto da abertura" : "Texto do capítulo"}
            className="w-full resize-y rounded border border-linha bg-folha px-3 py-2 font-mono text-xs leading-relaxed text-tinta"
          />
          <p className="text-xs text-tinta-suave">
            {abertura ? "Abertura" : "Este capítulo"}: {milhar(contarPalavras(edicao.texto))} palavras
          </p>
          {edicao.erro && (
            <p className="text-xs text-erro">
              {edicao.erro}
              {/Recarregue/.test(edicao.erro) && (
                <button type="button" onClick={onRecarregar} className="ml-2 underline">Recarregar a conferência</button>
              )}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onSalvar} disabled={edicao.salvando} className="rounded bg-tinta px-3 py-1.5 text-xs font-medium text-folha hover:bg-tinta/90 disabled:opacity-50">
              {edicao.salvando ? "Salvando…" : "Salvar"}
            </button>
            <button type="button" onClick={onCancelar} disabled={edicao.salvando} className="rounded border border-linha px-3 py-1.5 text-xs hover:bg-papel disabled:opacity-50">
              Cancelar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
