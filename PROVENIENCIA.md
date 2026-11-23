# Proveniência

Os módulos de áudio em `lib/audiolivro/`, a tela do audiolivro e a rota que a atende vêm do audiolivro da Autoria. Foram escritos pelo autor deste repositório entre 17 e 20 de novembro de 2026, no repositório privado da Autoria, e trazidos para cá sem histórico. Nenhum código anterior a 4 de novembro de 2026 faz parte deste repositório. O restante da plataforma Autoria não faz parte desta submissão.

| Arquivo | Origem |
|---|---|
| `lib/audiolivro/arquivos.ts` | motor Autoria |
| `lib/audiolivro/candidatos.ts` | motor Autoria |
| `lib/audiolivro/conferir.ts` | motor Autoria |
| `lib/audiolivro/config.ts` | motor Autoria |
| `lib/audiolivro/dividir.ts` | motor Autoria |
| `lib/audiolivro/gemini.ts` | motor Autoria; leitura da resposta em WAV acrescentada neste repositório |
| `lib/audiolivro/mp3.ts` | motor Autoria |
| `lib/audiolivro/nomes.ts` | motor Autoria |
| `lib/audiolivro/normalizar.ts` | motor Autoria |
| `lib/audiolivro/numeros.ts` | motor Autoria |
| `lib/audiolivro/pcm.ts` | motor Autoria |
| `lib/audiolivro/motor.ts` | motor Autoria, adaptado neste repositório: livro lido do .docx, banco e arquivos próprios da demonstração, sem conta de usuário, cobrança, e-mail nem prazo de guarda |
| `lib/audiolivro/pronuncia-ia.ts` | motor Autoria, adaptado: chama a API da Anthropic direto, com a chave da demonstração |
| `app/livro/[id]/tela-audiolivro.tsx` | tela do audiolivro da Autoria, adaptada: sem plano, cobrança nem conclusão; a narração anda com a página aberta; limites e avisos da demonstração; quem só tem o link ouve |
| `app/api/audiolivro/[id]/route.ts` | rota do audiolivro da Autoria, adaptada: acesso por token do livro em vez de conta; limites e aviso de créditos da demonstração |
| `public/logo-autoria.png`, `app/favicon.ico`, `app/icon.png`, `app/apple-icon.png`, `app/opengraph-image.png`, `app/twitter-image.png` | marca Autoria (logotipo e monograma do autor), redesenhados para ícone e imagem de compartilhamento |
| esqueleto Next.js | gerado com `create-next-app` (código aberto) |
| todo o resto | escrito neste repositório |

O histórico de commits desses módulos no repositório de origem está disponível para a Comissão, se solicitado.
