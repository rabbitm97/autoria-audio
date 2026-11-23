"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Candidato {
  pos: number;
  titulo: string;
  origem: "estilo" | "padrao" | "maiusculas";
  marcado: boolean;
  inicio: string;
  caracteres: number;
}

const ORIGEM: Record<Candidato["origem"], string> = {
  estilo: "Título do Word",
  padrao: "Começa como título",
  maiusculas: "Linha em maiúsculas",
};

/**
 * Capítulos propostos para o autor aprovar: marcar quais são capítulos e
 * ajustar os títulos. Cada capítulo aprovado vira um arquivo de áudio.
 */
export default function AprovacaoCapitulos({ id, token, onAprovado }: { id: string; token: string; onAprovado: () => void }) {
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [abertura, setAbertura] = useState(0);
  const [limite, setLimite] = useState(15000);
  const [incluirAbertura, setIncluirAbertura] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    (async () => {
      const res = await fetch(`/api/livros/${id}/capitulos`, { headers: { "x-livro-token": token }, cache: "no-store" }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!ativo) return;
      if (!res?.ok || !json?.candidatos) {
        setErro(json?.error ?? "Não foi possível carregar os capítulos.");
        return;
      }
      setCandidatos(json.candidatos);
      setAbertura(json.abertura ?? 0);
      setLimite(json.limite_caracteres ?? 15000);
    })();
    return () => {
      ativo = false;
    };
  }, [id, token]);

  if (!candidatos) {
    return <p className={`mt-6 ${erro ? "text-erro" : "text-tinta-suave"}`}>{erro ?? "Carregando os capítulos…"}</p>;
  }

  const marcados = candidatos.filter((c) => c.marcado);
  const total = marcados.reduce((s, c) => s + c.caracteres, 0) + (incluirAbertura ? abertura : 0);
  const atualizar = (pos: number, mudanca: Partial<Candidato>) =>
    setCandidatos(candidatos.map((c) => (c.pos === pos ? { ...c, ...mudanca } : c)));

  async function confirmar() {
    setSalvando(true);
    setErro(null);
    const res = await fetch(`/api/livros/${id}/capitulos`, {
      method: "POST",
      headers: { "x-livro-token": token, "Content-Type": "application/json" },
      body: JSON.stringify({
        aprovados: marcados.map((c) => ({ pos: c.pos, titulo: c.titulo })),
        incluir_abertura: incluirAbertura,
      }),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      setErro(json.error ?? "Não foi possível aprovar os capítulos.");
      setSalvando(false);
      return;
    }
    onAprovado();
  }

  return (
    <div className="mt-6">
      <h2 className="font-serif text-2xl">Capítulos detectados</h2>
      <p className="mt-1 max-w-[62ch] text-sm text-tinta-suave">
        Cada capítulo vira um arquivo de áudio. Marque quais são capítulos e ajuste os títulos se quiser.
      </p>

      {candidatos.length === 0 ? (
        <p className="mt-4 rounded-md border border-linha bg-folha p-4 text-sm">
          Não encontrei títulos de capítulo no arquivo. O livro inteiro vira um arquivo só. Para separar em capítulos, use os estilos de título do Word e envie de novo.
        </p>
      ) : (
        <ol className="mt-4 divide-y divide-linha rounded-lg border border-linha bg-folha">
          {candidatos.map((c) => (
            <li key={c.pos} className="flex gap-3 px-4 py-3">
              <input
                type="checkbox"
                checked={c.marcado}
                onChange={(e) => atualizar(c.pos, { marcado: e.target.checked })}
                aria-label={`Usar "${c.titulo}" como capítulo`}
                className="mt-2 accent-[var(--tinta)]"
              />
              <div className="min-w-0 flex-1">
                <input
                  value={c.titulo}
                  onChange={(e) => atualizar(c.pos, { titulo: e.target.value })}
                  disabled={!c.marcado}
                  maxLength={120}
                  aria-label="Título do capítulo"
                  className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 font-serif text-lg hover:border-linha focus:border-linha disabled:text-tinta-suave"
                />
                <p className="px-2 text-xs text-tinta-suave">
                  {ORIGEM[c.origem]} · {c.caracteres.toLocaleString("pt-BR")} caracteres
                </p>
                {c.inicio && <p className="truncate px-2 font-serif text-sm text-tinta-suave">{c.inicio}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {abertura > 0 && candidatos.length > 0 && (
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input type="checkbox" checked={incluirAbertura} onChange={(e) => setIncluirAbertura(e.target.checked)} className="mt-0.5 accent-[var(--tinta)]" />
          <span>
            Narrar também o texto antes do primeiro capítulo ({abertura.toLocaleString("pt-BR")} caracteres: folha de rosto, dedicatória, epígrafe).
          </span>
        </label>
      )}

      <p className="mt-4 text-sm text-tinta-suave">
        {marcados.length} {marcados.length === 1 ? "capítulo marcado" : "capítulos marcados"}, {total.toLocaleString("pt-BR")} caracteres.
        {total > limite && ` Nesta demonstração a narração vai até ${limite.toLocaleString("pt-BR")} caracteres: entram os primeiros capítulos.`}
      </p>

      {erro && <p role="alert" className="mt-3 text-sm text-erro">{erro}</p>}
      <div className="mt-5 flex items-center gap-5">
        <button onClick={confirmar} disabled={salvando} className="rounded-md bg-tinta px-5 py-2.5 font-medium text-folha hover:bg-tinta/90 disabled:opacity-60">
          {salvando ? "Montando os capítulos…" : "Continuar"}
        </button>
        <Link href="/" className="text-sm underline">Enviar outro arquivo</Link>
      </div>
    </div>
  );
}
