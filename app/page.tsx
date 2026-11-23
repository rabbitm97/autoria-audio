import FormularioEnvio from "./_componentes/formulario-envio";

const ETAPAS = [
  ["Lê o manuscrito", "Os capítulos saem dos títulos do seu .docx."],
  ["Prepara a fala", "Números, horas, valores e abreviações viram o que se fala; você ensina a pronúncia dos nomes."],
  ["Narra e confere", "Cada trecho é narrado, ouvido de volta e refeito se a fala sair diferente do texto."],
  ["Entrega", "Um MP3 por capítulo, com créditos de abertura e de encerramento, num ZIP pronto para publicar."],
] as const;

export default function Home() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <h1 className="font-serif text-4xl leading-tight sm:text-5xl">Seu manuscrito, lido em voz alta.</h1>
      <p className="mt-4 max-w-[60ch] text-lg text-tinta-suave">
        Envie o livro em .docx, escolha a voz e ouça o audiolivro tomar forma, trecho por trecho. Você ajusta o que a voz fala antes de baixar.
      </p>

      <ol className="mt-10 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {ETAPAS.map(([titulo, texto], i) => (
          <li key={titulo} className="flex gap-3">
            <span aria-hidden className="mt-0.5 font-serif text-latao">{i + 1}</span>
            <div>
              <p className="font-medium">{titulo}</p>
              <p className="text-sm text-tinta-suave">{texto}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="mt-12" aria-labelledby="enviar">
        <h2 id="enviar" className="mb-4 font-serif text-2xl">Narre um livro</h2>
        <FormularioEnvio />
      </section>
    </div>
  );
}
