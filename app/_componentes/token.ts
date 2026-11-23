// Token de quem enviou o livro, guardado só neste navegador.

const chave = (id: string) => `autoria-audio:token:${id}`;

export function guardarToken(id: string, token: string): void {
  try {
    localStorage.setItem(chave(id), token);
  } catch {
    // navegador sem armazenamento: o livro fica só para ouvir
  }
}

export function lerToken(id: string): string | null {
  try {
    return localStorage.getItem(chave(id));
  } catch {
    return null;
  }
}
