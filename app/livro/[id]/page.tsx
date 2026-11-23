import TelaLivro from "./tela-livro";

export default async function PaginaLivro({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TelaLivro id={id} />;
}
