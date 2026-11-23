import type { Metadata } from "next";
import { Figtree, Literata } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const ui = Figtree({ variable: "--fonte-ui", subsets: ["latin"] });
const livro = Literata({ variable: "--fonte-livro", subsets: ["latin"], style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "Autoria Áudio",
  description: "Envie o manuscrito em .docx e ouça o seu livro narrado, um arquivo por capítulo.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${ui.variable} ${livro.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-linha bg-folha">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
            <Link href="/" className="font-serif text-lg text-tinta">
              Autoria Áudio
            </Link>
            <a href="https://useautoria.com" className="text-sm text-tinta-suave hover:text-tinta">
              useautoria.com
            </a>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-linha px-5 py-6 text-center text-xs text-tinta-suave">
          Narração por IA a partir do seu manuscrito. Demonstração com limite de tamanho e de uso diário.
        </footer>
      </body>
    </html>
  );
}
