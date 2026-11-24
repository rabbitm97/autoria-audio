import type { Metadata } from "next";
import { Figtree, Fraunces } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";

const ui = Figtree({ variable: "--fonte-ui", subsets: ["latin"] });
const livro = Fraunces({ variable: "--fonte-livro", subsets: ["latin"], style: ["normal", "italic"] });

const DESCRICAO = "Envie o manuscrito em .docx, .pdf ou .txt e ouça o seu livro narrado por IA, conferido trecho a trecho, com um MP3 por capítulo.";

export const metadata: Metadata = {
  metadataBase: new URL("https://autoria-audio.vercel.app"),
  title: "Autoria Áudio — seu manuscrito, lido em voz alta",
  description: DESCRICAO,
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Autoria Áudio",
    title: "Autoria Áudio — seu manuscrito, lido em voz alta",
    description: DESCRICAO,
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${ui.variable} ${livro.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-linha bg-folha">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4">
            <Link href="/" className="flex items-baseline gap-2" aria-label="Autoria Áudio, página inicial">
              <Image src="/logo-autoria.png" alt="" width={640} height={104} priority className="h-5 w-auto sm:h-6" />
              <span className="font-serif text-lg italic text-ouro sm:text-xl">Áudio</span>
            </Link>
            <a href="https://useautoria.com" className="text-sm text-tinta-suave hover:text-tinta">
              useautoria.com
            </a>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-linha px-5 py-6 text-center text-xs text-tinta-suave">
          O módulo de audiolivro da <a href="https://useautoria.com" className="underline hover:text-tinta">Autoria</a>, em versão de demonstração.
        </footer>
      </body>
    </html>
  );
}
