"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { guardarToken } from "./token";

export default function FormularioEnvio() {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const res = await fetch("/api/livros", { method: "POST", body: new FormData(e.currentTarget) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.id) {
        setErro(json.error ?? "Não foi possível enviar. Tente de novo.");
        setEnviando(false);
        return;
      }
      guardarToken(json.id, json.token);
      router.push(`/livro/${json.id}`);
    } catch {
      setErro("Sem conexão. Confira a internet e tente de novo.");
      setEnviando(false);
    }
  }

  const campo = "mt-1 w-full rounded-md border border-linha bg-folha px-3 py-2 text-tinta placeholder:text-tinta-suave/60";

  return (
    <form onSubmit={enviar} className="space-y-5 rounded-lg border border-linha bg-folha p-6">
      <div>
        <label htmlFor="arquivo" className="text-sm font-medium">
          Manuscrito (.docx)
        </label>
        <input id="arquivo" name="arquivo" type="file" accept=".docx" required className={`${campo} file:mr-3 file:rounded file:border-0 file:bg-tinta file:px-3 file:py-1 file:text-sm file:text-folha`} />
        <p className="mt-1 text-xs text-tinta-suave">
          Use os estilos de título do Word nos capítulos para que eles sejam reconhecidos. Na demonstração, até 15 mil caracteres: o restante fica de fora.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="titulo" className="text-sm font-medium">Título</label>
          <input id="titulo" name="titulo" required maxLength={120} className={campo} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="subtitulo" className="text-sm font-medium">Subtítulo (opcional)</label>
          <input id="subtitulo" name="subtitulo" maxLength={160} className={campo} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="autor" className="text-sm font-medium">Autoria</label>
          <input id="autor" name="autor" required maxLength={120} placeholder="Nome como vai na capa" className={campo} />
        </div>
      </div>
      {erro && <p role="alert" className="text-sm text-erro">{erro}</p>}
      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-md bg-tinta px-4 py-3 font-medium text-folha hover:bg-tinta/90 disabled:opacity-60"
      >
        {enviando ? "Lendo o manuscrito…" : "Ler os capítulos"}
      </button>
    </form>
  );
}
