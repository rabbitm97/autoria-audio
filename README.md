# Autoria Áudio

Transforma um manuscrito em `.docx`, `.pdf` ou `.txt` num audiolivro narrado por IA, em português do Brasil: um MP3 por capítulo, com créditos falados, cada trecho conferido antes de entrar no arquivo final.

É o módulo de audiolivro da [Autoria](https://useautoria.com), plataforma de autopublicação para autores independentes, publicado aqui como uma aplicação de demonstração própria.

**Demonstração:** [autoria-audio.vercel.app](https://autoria-audio.vercel.app). Na página inicial há um exemplo já narrado, "Missa do Galo", de Machado de Assis, para ouvir sem enviar nada.

## O problema

Um audiolivro gravado em estúdio custa caro e leva semanas, e por isso a maior parte dos autores independentes nunca tem o seu. A narração por IA resolve o custo, mas o resultado costuma ter defeitos que ninguém confere: trecho pulado, palavra trocada, nome próprio lido errado, número dito do jeito errado. O autor só descobre quando um leitor reclama.

## Como funciona para o autor

1. **Manuscrito:** título, autor, o arquivo do livro e a declaração de que tem os direitos sobre o texto.
2. **Capítulos:** a demonstração propõe os capítulos que encontrou (pelos estilos de título do Word, por "Capítulo 1" e semelhantes, ou por títulos em maiúsculas) e diz de onde tirou cada um. O autor marca, desmarca e renomeia.
3. **Narração:** escolhe a voz ouvindo amostras, confere como a voz fala os nomes do livro (com sugestões de pronúncia por IA) e gera. Ao final ouve cada capítulo, vê os trechos que a conferência apontou, gera de novo ou ajusta o texto falado de um trecho, e baixa o ZIP.

Quem recebe o link do livro só ouve. Mudar a narração exige o token guardado no navegador de quem enviou.

## Como funciona por dentro

- **Leitura** (`lib/adaptadores/manuscrito.ts`): `.docx` pelo mammoth; `.pdf` pelo unpdf, tirando cabeçalho, rodapé e número de página repetidos e emendando palavras hifenizadas; `.txt` por parágrafos.
- **Preparação para a fala** (`lib/audiolivro/normalizar.ts`, `numeros.ts`): números, horas, valores, ordinais, algarismos romanos e abreviações por extenso; as pronúncias escolhidas pelo autor são aplicadas aqui.
- **Divisão em trechos** (`dividir.ts`): por parágrafo, no tamanho que a voz narra bem. Cada trecho tem um hash do texto e da voz: mudar a pronúncia de um nome refaz só os trechos em que ele aparece.
- **Voz** (`gemini.ts`): Gemini TTS, com uma instrução de estilo fixa para todo o livro.
- **Conferência** (`conferir.ts`): cada trecho narrado é transcrito por um segundo modelo e comparado com o texto. Duração fora do esperado, palavras faltando ou sobrando e volume estourado marcam o trecho para o autor ouvir; falhas de serviço são tentadas de novo sozinhas.
- **Montagem** (`pcm.ts`, `mp3.ts`, `arquivos.ts`): os trechos são nivelados e unidos com pausas, cada capítulo vira um MP3, os créditos de abertura e encerramento são narrados, e o ZIP sai com nomes de arquivo numerados na ordem do livro.
- **Pronúncia por IA** (`pronuncia-ia.ts`): Claude lê os nomes próprios do livro e sugere como a voz deve dizer os que ela tende a errar. Nada é gravado sem o autor aceitar.
- **Fila** (`motor.ts` e a função `reservar_trechos` no banco): os trechos são reservados em lotes, então a narração continua de onde parou se a página fechar ou o serviço de voz pedir pausa.

## Limites da demonstração

- Até 15 mil caracteres por livro (passando disso, entram os primeiros capítulos) e arquivo de até 50 MB.
- 10 regenerações por livro, contando "gerar de novo", edição de fala e mudança de pronúncia em trechos já narrados.
- 3 livros narrados por endereço e 40 no total por dia.
- A narração anda enquanto a página está aberta. Se a cota ou o orçamento do serviço de voz acabar, a demonstração avisa na página inicial e na tela do livro, não começa narrações novas e retoma de onde parou quando os créditos voltam.

## Tecnologia

Next.js 16 (App Router) na Vercel, Supabase (Postgres e Storage), Gemini TTS para a voz, Gemini para a transcrição, Claude para a sugestão de pronúncia. Todas as chaves ficam só no servidor.

## Rodar localmente

1. `npm ci`
2. Num projeto Supabase novo, rode no SQL Editor, nesta ordem: `supabase/schema.sql`, `supabase/002_manuscrito.sql`, `supabase/003_avisos.sql`.
3. Copie `.env.example` para `.env.local` e preencha.
4. `npm run dev`

## Origem do código e do exemplo

O motor de áudio, a tela do audiolivro e a rota que a atende vêm da Autoria e foram escritos em novembro de 2026; o restante foi escrito neste repositório. Detalhes arquivo a arquivo em [PROVENIENCIA.md](PROVENIENCIA.md).

O texto do exemplo é "Missa do Galo" (1893), de Machado de Assis, em domínio público, na edição da *Obra Completa* disponibilizada pelo MEC.

## Licença

[PolyForm Noncommercial 1.0.0](LICENSE): pode ler, rodar e testar livremente; uso comercial depende de autorização.
