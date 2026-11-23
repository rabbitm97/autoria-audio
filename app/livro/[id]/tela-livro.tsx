"use client";

// Tela de um livro: aprovação dos capítulos (só quem enviou) e, depois, a
// tela do audiolivro.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { lerToken } from "@/app/_componentes/token";
import Etapas from "@/app/_componentes/etapas";
import AprovacaoCapitulos from "@/app/_componentes/aprovacao-capitulos";
import TelaAudiolivro from "./tela-audiolivro";

interface Estado {
  livro: { id: string; titulo: string; subtitulo: string | null; autor: string };
  dono: boolean;
  etapa: "capitulos" | "narracao";
  narracao_comecou: boolean;
}

export default function TelaLivro({ id }: { id: string }) {
  const router = useRouter();
  // ?capitulos=1: o autor voltou para mudar capítulos ou texto antes de narrar.
  const voltarAosCapitulos = useSearchParams().get("capitulos") === "1";
  const [estado, setEstado] = useState<Estado | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  // undefined: ainda não leu o token deste navegador; null: não tem.
  const [token, setToken] = useState<string | null | undefined>(undefined);

  // Token deste navegador (só quem enviou o livro tem).
  useEffect(() => {
    const t = lerToken(id);
    queueMicrotask(() => setToken(t));
  }, [id]);

  const carregar = useCallback(async () => {
    if (token === undefined) return;
    const res = await fetch(`/api/livros/${id}`, { headers: token ? { "x-livro-token": token } : {}, cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) {
      setErroCarga(json?.error ?? "Não foi possível abrir este livro.");
      return;
    }
    setEstado(json as Estado);
  }, [id, token]);

  useEffect(() => {
    queueMicrotask(() => void carregar());
  }, [carregar]);

  if (erroCarga) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-12">
        <p className="text-erro">{erroCarga}</p>
        <Link href="/" className="mt-4 inline-block underline">Enviar um livro</Link>
      </div>
    );
  }
  if (!estado || token === undefined) {
    return <div className="mx-auto max-w-3xl px-5 py-12 text-tinta-suave">Abrindo o livro…</div>;
  }

  const naEtapaCapitulos =
    estado.etapa === "capitulos" || (voltarAosCapitulos && estado.dono && !!token && !estado.narracao_comecou);
  if (naEtapaCapitulos) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-10">
        <Etapas atual={2} />
        <h1 className="mt-6 font-serif text-3xl leading-tight sm:text-4xl">{estado.livro.titulo}</h1>
        <p className="mt-2 text-tinta-suave">{estado.livro.autor}</p>
        {estado.dono && token ? (
          <AprovacaoCapitulos
            id={id}
            token={token}
            onAprovado={() => {
              if (voltarAosCapitulos) router.replace(`/livro/${id}`);
              void carregar();
            }}
          />
        ) : (
          <p className="mt-6 text-tinta-suave">Este livro ainda está sendo preparado.</p>
        )}
      </div>
    );
  }

  return <TelaAudiolivro id={id} token={token} />;
}
