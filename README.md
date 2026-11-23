# Autoria Áudio

Transforma um manuscrito em `.docx` num audiolivro narrado por IA, em português do Brasil: um arquivo de áudio por capítulo, com créditos falados, pronto para publicar.

É o módulo de audiolivro da [Autoria](https://useautoria.com), plataforma de autopublicação para autores independentes, com uma aplicação de demonstração própria.

## Como funciona

1. **Leitura:** o `.docx` vira uma lista de capítulos.
2. **Preparação:** cada capítulo é dividido em trechos e o texto é normalizado para a fala (números, horas, valores, ordinais, algarismos romanos e abreviações por extenso), com atenção à pronúncia dos nomes próprios.
3. **Voz:** cada trecho é narrado pelo Gemini (PCM), conferido por duração e por transcrição, e refeito quando sai do padrão. O autor pode editar a fala de um trecho e gerar de novo.
4. **Montagem:** os trechos são nivelados e unidos com pausas, cada capítulo vira um MP3, os créditos de abertura e de encerramento são narrados, e tudo sai num ZIP com os nomes de arquivo padronizados.

## Estado

Em construção.

## Licença

[PolyForm Noncommercial 1.0.0](LICENSE): pode ler, rodar e testar livremente; uso comercial depende de autorização.

Origem dos arquivos: [PROVENIENCIA.md](PROVENIENCIA.md).
