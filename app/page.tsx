import Assistente from "./_componentes/formulario-envio";
import { supabaseAdmin } from "@/lib/adaptadores/supabase";
import { MSG_SEM_CREDITOS, creditosEsgotados } from "@/lib/adaptadores/avisos";

// O aviso de créditos esgotados depende do momento: sem cache.
export const dynamic = "force-dynamic";

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
      <Assistente />
    </div>
  );
}
