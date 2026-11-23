import Link from "next/link";
import Assistente from "./_componentes/formulario-envio";
import { supabaseAdmin } from "@/lib/adaptadores/supabase";
import { MSG_SEM_CREDITOS, creditosEsgotados } from "@/lib/adaptadores/avisos";
import { livroDeExemplo } from "@/lib/adaptadores/livros";
import { linksDosCapitulos } from "@/lib/audiolivro/motor";
import { AUDIO_VOZES } from "@/lib/audiolivro/config";

// O aviso de créditos e os links do exemplo (válidos por 1 hora) dependem do momento: sem cache.
export const dynamic = "force-dynamic";

function minutos(ms: number | null): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

async function Exemplo() {
  const admin = supabaseAdmin();
  const livro = await livroDeExemplo(admin).catch(() => null);
  const dados = livro?.dados;
  if (!livro || !dados) return null;
  const links = await linksDosCapitulos(admin, dados);
  const capitulos = dados.capitulos.filter((c) => c.trechos > 0 && links[c.index]);
  if (capitulos.length === 0) return null;
  const total = capitulos.reduce((s, c) => s + (c.duracao_ms ?? 0), 0);
  const voz = AUDIO_VOZES.find((v) => v.id === dados.voz)?.nome ?? dados.voz;
  return (
    <section aria-labelledby="exemplo-titulo" className="mt-10 rounded-2xl border border-linha bg-folha p-5 sm:p-6">
      <p className="text-sm text-tinta-suave">Ouça antes de enviar</p>
      <h2 id="exemplo-titulo" className="mt-1 font-serif text-2xl text-tinta">
        {livro.titulo}, de {livro.autor}
      </h2>
      <p className="mt-1 text-sm text-tinta-suave">
        Narrado nesta demonstração com a voz {voz}, {minutos(total)} de áudio. Conto de 1893, em domínio público.
      </p>
      <ul className="mt-4 space-y-3">
        {capitulos.map((c) => (
          <li key={c.index}>
            <p className="text-sm text-tinta">
              {c.titulo} <span className="text-tinta-suave">· {minutos(c.duracao_ms)}</span>
            </p>
            <audio controls preload="none" src={links[c.index]} className="mt-1 w-full" />
          </li>
        ))}
      </ul>
      <Link href={`/livro/${livro.id}`} className="mt-4 inline-block text-sm text-tinta underline">
        Ver o audiolivro completo, trecho a trecho
      </Link>
    </section>
  );
}

export default async function Home() {
  const semCreditos = await creditosEsgotados(supabaseAdmin()).catch(() => false);
  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      {semCreditos && (
        <p role="status" className="mb-8 rounded-xl border border-latao/40 bg-latao-claro/50 p-4 text-sm text-tinta">{MSG_SEM_CREDITOS}</p>
      )}
      <h1 className="font-serif text-4xl leading-tight sm:text-5xl">Seu manuscrito, lido em voz alta.</h1>
      <p className="mt-4 max-w-[60ch] text-lg text-tinta-suave">
        O audiolivro da Autoria: do arquivo do livro a um áudio por capítulo, com a voz que você escolher, os nomes ditos do seu jeito e cada trecho conferido antes de ir para o arquivo final.
      </p>
      <Exemplo />
      <Assistente />
    </div>
  );
}
