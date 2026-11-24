"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { guardarToken } from "./token";
import Etapas from "./etapas";

const TAMANHO_MAX = 50 * 1024 * 1024;

/** Envia o arquivo direto ao armazenamento, com o andamento do envio. */
function enviarArquivo(url: string, arquivo: File, onProgresso: (p: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", arquivo.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgresso(e.loaded / e.total);
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.send(arquivo);
  });
}

function tamanhoLegivel(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Confere formato e tamanho; devolve o problema, ou null. */
function problemaDoArquivo(f: File): string | null {
  if (!/\.(docx|pdf|txt)$/i.test(f.name)) return "Formato inválido. Aceitos: .docx, .pdf ou .txt";
  if (f.size > TAMANHO_MAX) return "Arquivo muito grande. Máximo: 50 MB";
  return null;
}

const ITENS_DECLARACAO = [
  "O texto enviado é de minha autoria, ou tenho autorização de quem detém os direitos para transformá-lo em audiolivro.",
  "O texto não reproduz obra de terceiros protegida por direito autoral sem permissão (obras em domínio público podem ser usadas).",
  "Tenho o direito de usar os nomes, marcas e trechos citados no texto.",
  "Entendo que o arquivo é usado só para gerar a narração, nunca para treinar IA, e é apagado depois da leitura do texto.",
  "Respondo pelo conteúdo enviado e pelo uso que fizer do áudio gerado.",
];

export default function Assistente() {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [passo, setPasso] = useState<0 | 1>(0);
  const [titulo, setTitulo] = useState("");
  const [autor, setAutor] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [declaracao, setDeclaracao] = useState(false);
  const [verDeclaracao, setVerDeclaracao] = useState(false);
  const [andamento, setAndamento] = useState<{ texto: string; pct: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const pronto = !!titulo.trim() && !!arquivo && declaracao;

  function escolher(f: File | undefined) {
    if (!f) return;
    const p = problemaDoArquivo(f);
    setErroArquivo(p);
    setArquivo(p ? null : f);
  }

  async function continuar() {
    if (!pronto || !arquivo) return;
    setErro(null);
    setAndamento({ texto: "Registrando o livro…", pct: 5 });
    try {
      const res = await fetch("/api/livros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo, autor, declaracao, arquivo: { nome: arquivo.name, tamanho: arquivo.size } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.id) throw new Error(json.error ?? "Não foi possível registrar o livro.");
      guardarToken(json.id, json.token);

      setAndamento({ texto: "Enviando o manuscrito…", pct: 10 });
      const ok = await enviarArquivo(json.envio, arquivo, (p) => setAndamento({ texto: "Enviando o manuscrito…", pct: 10 + Math.round(p * 60) }));
      if (!ok) throw new Error("O envio do arquivo falhou. Confira a conexão e tente de novo.");

      setAndamento({ texto: "Lendo o texto do livro…", pct: 75 });
      const res2 = await fetch(`/api/livros/${json.id}/manuscrito`, { method: "POST", headers: { "x-livro-token": json.token } });
      const json2 = await res2.json().catch(() => ({}));
      if (!res2.ok) throw new Error(json2.error ?? "Não foi possível ler o manuscrito.");
      setAndamento({ texto: "Detectando capítulos…", pct: 90 });
      router.push(`/livro/${json.id}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    }
  }

  const campo = "mt-1 w-full rounded-md border border-linha bg-folha px-3 py-2.5 text-sm text-tinta placeholder:text-tinta-suave/70";

  if (passo === 0) {
    return (
      <section className="mt-8 rounded-lg border border-linha bg-folha p-6">
        <Etapas atual={0} />
        <h2 className="mt-6 font-serif text-2xl">Como funciona</h2>
        <p className="mt-2 max-w-[62ch] text-tinta-suave">
          Envie o texto do seu livro, aprove os capítulos, escolha a voz e confira os nomes. A narração roda sozinha e você recebe um arquivo de áudio por capítulo.
        </p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-tinta-suave">
          <li>Livro de qualquer tamanho: todos os capítulos são narrados.</li>
          <li>Depois de ouvir, você pode refazer ou ajustar a fala de qualquer trecho.</li>
          <li>Mantenha a página aberta enquanto o livro é narrado. Livros longos levam mais tempo.</li>
        </ul>
        <button onClick={() => setPasso(1)} className="mt-6 rounded-md bg-tinta px-5 py-2.5 font-medium text-folha hover:bg-tinta/90">
          Começar
        </button>
      </section>
    );
  }

  if (andamento) {
    return (
      <section className="mt-8 rounded-lg border border-linha bg-folha p-6">
        <Etapas atual={1} />
        <h2 className="mt-6 font-serif text-2xl">{erro ? "Envio interrompido" : "Preparando o livro…"}</h2>
        {erro ? (
          <div className="mt-4 space-y-4">
            <p role="alert" className="rounded-lg border border-erro/30 bg-erro/5 p-4 text-sm text-erro">{erro}</p>
            <button
              onClick={() => { setErro(null); setAndamento(null); }}
              className="w-full rounded-md bg-tinta px-4 py-3 font-medium text-folha hover:bg-tinta/90"
            >
              Voltar e tentar de novo
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-tinta-suave" aria-live="polite">{andamento.texto}</span>
              <span className="text-tinta-suave">{andamento.pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-linha" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={andamento.pct}>
              <div className="h-full bg-latao transition-all duration-500" style={{ width: `${andamento.pct}%` }} />
            </div>
            <p className="text-center text-xs text-tinta-suave">Isso pode levar alguns minutos. Não feche esta janela.</p>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-lg border border-linha bg-folha p-6">
      <Etapas atual={1} />
      <h2 className="mt-6 font-serif text-2xl">Seu manuscrito</h2>
      <div className="mt-4 space-y-5">
        <div>
          <label htmlFor="titulo" className="text-sm font-medium">Título do livro *</label>
          <input id="titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} placeholder="O título do seu manuscrito" className={campo} />
        </div>
        <div>
          <label htmlFor="autor" className="text-sm font-medium">Autor (opcional)</label>
          <input id="autor" value={autor} onChange={(e) => setAutor(e.target.value)} maxLength={120} placeholder="Nome do autor" className={campo} />
        </div>
        <div>
          <p className="text-sm font-medium" id="rotulo-arquivo">Manuscrito *</p>
          <div
            role="button"
            tabIndex={0}
            aria-labelledby="rotulo-arquivo"
            onClick={() => entrada.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); entrada.current?.click(); } }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); escolher(e.dataTransfer.files[0]); }}
            className="mt-1 cursor-pointer rounded-xl border-2 border-dashed border-linha p-6 text-center transition-colors hover:border-latao/60"
          >
            <input
              ref={entrada}
              id="arquivo"
              type="file"
              accept=".docx,.pdf,.txt"
              className="hidden"
              onChange={(e) => escolher(e.target.files?.[0])}
            />
            {arquivo ? (
              <div className="space-y-1">
                <p className="text-sm font-medium text-tinta">{arquivo.name}</p>
                <p className="text-xs text-tinta-suave">{tamanhoLegivel(arquivo.size)}</p>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setArquivo(null); if (entrada.current) entrada.current.value = ""; }}
                  className="mt-1 text-xs text-tinta-suave underline"
                >
                  Remover
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-sm text-tinta-suave">Arraste ou clique para selecionar</p>
                <p className="text-xs text-tinta-suave">.docx, .pdf ou .txt · máx. 50 MB</p>
              </div>
            )}
          </div>
          {erroArquivo && <p className="mt-1 text-xs text-erro">{erroArquivo}</p>}
          <p className="mt-2 text-xs text-ouro">Prefira .docx ou .txt. PDF costuma juntar ou separar parágrafos e confundir a detecção de capítulos.</p>
        </div>

        <p className="flex items-start gap-2.5 rounded-xl border border-tinta/15 bg-tinta/[0.04] p-3 text-xs leading-relaxed text-tinta/80">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0 text-tinta" aria-hidden>
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>
            <strong className="font-semibold text-tinta">Sua obra continua 100% sua.</strong> O manuscrito é usado só para gerar a narração — nunca para treinar IA — e o arquivo é apagado depois da leitura do texto.
          </span>
        </p>

        <div className="rounded-xl border border-linha bg-papel/60">
          <button
            type="button"
            onClick={() => setVerDeclaracao(!verDeclaracao)}
            aria-expanded={verDeclaracao}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          >
            <span className="text-sm font-semibold text-tinta">Declaração de titularidade</span>
            <span className="text-xs text-tinta-suave">{verDeclaracao ? "Recolher −" : `Ler os ${ITENS_DECLARACAO.length} itens +`}</span>
          </button>
          {verDeclaracao && (
            <ol className="list-decimal space-y-2 border-t border-linha px-4 pb-4 pl-9 pt-3 text-sm leading-relaxed text-tinta">
              {ITENS_DECLARACAO.map((i) => <li key={i}>{i}</li>)}
            </ol>
          )}
          <label className="flex cursor-pointer items-start gap-3 border-t border-linha px-4 py-3">
            <input type="checkbox" checked={declaracao} onChange={(e) => setDeclaracao(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--tinta)]" />
            <span className="text-sm leading-relaxed text-tinta">Li e concordo com a declaração de titularidade acima.</span>
          </label>
        </div>

        <button
          onClick={continuar}
          disabled={!pronto}
          className="w-full rounded-md bg-tinta px-4 py-3 font-medium text-folha hover:bg-tinta/90 disabled:opacity-50"
        >
          Continuar
        </button>
      </div>
    </section>
  );
}
