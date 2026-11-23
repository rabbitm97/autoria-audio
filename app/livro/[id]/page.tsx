import { Suspense } from "react";
import TelaLivro from "./tela-livro";

export default async function PaginaLivro({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl px-5 py-12 text-tinta-suave">Abrindo o livro…</div>}>
      <TelaLivro id={id} />
    </Suspense>
  );
}
