// Etapas do audiolivro, na ordem em que o autor passa por elas.

export const ETAPAS = ["Início", "Manuscrito", "Capítulos", "Narração"] as const;

export default function Etapas({ atual }: { atual: number }) {
  return (
    <ol className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Etapas">
      {ETAPAS.map((nome, i) => (
        <li key={nome} className="flex items-center gap-2" aria-current={i === atual ? "step" : undefined}>
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
              i < atual ? "bg-tinta text-folha" : i === atual ? "bg-latao text-folha" : "border border-linha text-tinta-suave"
            }`}
          >
            {i + 1}
          </span>
          <span className={i === atual ? "font-medium" : "text-tinta-suave"}>{nome}</span>
        </li>
      ))}
    </ol>
  );
}
