"use client";

import { useState } from "react";
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

export default function Assistente() {
  const router = useRouter();
  const [passo, setPasso] = useState<0 | 1>(0);
  const [titulo, setTitulo] = useState("");
  const [autor, setAutor] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [declaracao, setDeclaracao] = useState(false);
  const [verDeclaracao, setVerDeclaracao] = useState(false);
  const [andamento, setAndamento] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const pronto = titulo.trim() && autor.trim() && arquivo && declaracao;

  async function continuar() {
    if (!pronto || !arquivo) return;
    if (arquivo.size > TAMANHO_MAX) {
      setErro("O arquivo precisa ter até 50 MB.");
      return;
    }
    setErro(null);
    setAndamento("Registrando o livro…");
    try {
      const res = await fetch("/api/livros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo, autor, declaracao, arquivo: { nome: arquivo.name, tamanho: arquivo.size } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.id) throw new Error(json.error ?? "Não foi possível registrar o livro.");
      guardarToken(json.id, json.token);

      setAndamento("Enviando o manuscrito… 0%");
      const ok = await enviarArquivo(json.envio, arquivo, (p) => setAndamento(`Enviando o manuscrito… ${Math.round(p * 100)}%`));
      if (!ok) throw new Error("O envio do arquivo falhou. Confira a conexão e tente de novo.");

      setAndamento("Lendo o texto e procurando os capítulos…");
      const res2 = await fetch(`/api/livros/${json.id}/manuscrito`, { method: "POST", headers: { "x-livro-token": json.token } });
      const json2 = await res2.json().catch(() => ({}));
      if (!res2.ok) throw new Error(json2.error ?? "Não foi possível ler o manuscrito.");
      router.push(`/livro/${json.id}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
      setAndamento(null);
    }
  }

  const campo = "mt-1 w-full rounded-md border border-linha bg-folha px-3 py-2 text-tinta";

  if (passo === 0) {
    return (
      <section className="mt-8 rounded-lg border border-linha bg-folha p-6">
        <Etapas atual={0} />
        <h2 className="mt-6 font-serif text-2xl">Como funciona</h2>
        <p className="mt-2 max-w-[62ch] text-tinta-suave">
          Envie o texto do seu livro, aprove os capítulos, escolha a voz e confira os nomes. A narração roda sozinha e você recebe um arquivo de áudio por capítulo.
        </p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-tinta-suave">
          <li>Nesta demonstração, a narração vai até 15 mil caracteres (os primeiros capítulos, cerca de 16 minutos de áudio).</li>
          <li>Você pode refazer ou ajustar até 10 trechos depois de ouvir.</li>
          <li>Mantenha a página aberta enquanto o livro é narrado.</li>
        </ul>
        <button onClick={() => setPasso(1)} className="mt-6 rounded-md bg-tinta px-5 py-2.5 font-medium text-folha hover:bg-tinta/90">
          Começar
        </button>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-lg border border-linha bg-folha p-6">
      <Etapas atual={1} />
      <h2 className="mt-6 font-serif text-2xl">Seu manuscrito</h2>

      {andamento ? (
        <p className="mt-6 text-tinta-suave" aria-live="polite">{andamento}</p>
      ) : (
        <div className="mt-4 space-y-5">
          <div>
            <label htmlFor="titulo" className="text-sm font-medium">Título do livro</label>
            <input id="titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} className={campo} />
          </div>
          <div>
            <label htmlFor="autor" className="text-sm font-medium">Autor ou autora</label>
            <input id="autor" value={autor} onChange={(e) => setAutor(e.target.value)} maxLength={120} placeholder="Nome como vai na capa" className={campo} />
          </div>
          <div>
            <label htmlFor="arquivo" className="text-sm font-medium">Arquivo do livro</label>
            <input
              id="arquivo"
              type="file"
              accept=".docx,.pdf,.txt"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className={`${campo} file:mr-3 file:rounded file:border-0 file:bg-tinta file:px-3 file:py-1 file:text-sm file:text-folha`}
            />
            <p className="mt-1 text-xs text-tinta-suave">.docx, .pdf ou .txt, até 50 MB. No .docx, os estilos de título do Word ajudam a achar os capítulos.</p>
          </div>
          <div className="rounded-md border border-linha p-3">
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={declaracao} onChange={(e) => setDeclaracao(e.target.checked)} className="mt-0.5 accent-[var(--tinta)]" />
              <span>Declaro que sou titular dos direitos deste texto ou tenho autorização para transformá-lo em audiolivro.</span>
            </label>
            <button type="button" onClick={() => setVerDeclaracao(!verDeclaracao)} aria-expanded={verDeclaracao} className="mt-2 text-xs underline">
              {verDeclaracao ? "Fechar a declaração" : "Ler a declaração"}
            </button>
            {verDeclaracao && (
              <p className="mt-2 text-xs leading-relaxed text-tinta-suave">
                Ao enviar, você declara que o texto é de sua autoria, que você detém os direitos de adaptação para áudio ou que tem autorização de quem os detém, e que ele não reproduz obra de terceiros sem permissão. O arquivo é usado só para gerar a narração e é apagado depois da leitura do texto.
              </p>
            )}
          </div>
          {erro && <p role="alert" className="text-sm text-erro">{erro}</p>}
          <button
            onClick={continuar}
            disabled={!pronto}
            className="w-full rounded-md bg-tinta px-4 py-3 font-medium text-folha hover:bg-tinta/90 disabled:opacity-50"
          >
            Continuar
          </button>
        </div>
      )}
    </section>
  );
}
