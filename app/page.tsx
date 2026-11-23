import Assistente from "./_componentes/formulario-envio";

export default function Home() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <h1 className="font-serif text-4xl leading-tight sm:text-5xl">Seu manuscrito, lido em voz alta.</h1>
      <p className="mt-4 max-w-[60ch] text-lg text-tinta-suave">
        O audiolivro da Autoria: do arquivo do livro a um áudio por capítulo, com a voz que você escolher, os nomes ditos do seu jeito e cada trecho conferido antes de ir para o arquivo final.
      </p>
      <Assistente />
    </div>
  );
}
