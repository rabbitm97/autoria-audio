// lib/audiolivro/pcm.ts
//
// D60-A. Tratamento do áudio cru que o Gemini devolve (PCM 16 bits, mono,
// 24 kHz): medir, aparar o silêncio das pontas, nivelar o volume e
// reamostrar para 44,1 kHz (padrão das lojas de audiolivro).
//
// Nível (aprovado em 17/nov): RMS alvo de -20 dBFS com pico máximo de -3 dBFS
// (faixa de -23 a -18 dB RMS das lojas). Cada trecho é nivelado sozinho, e por
// isso o volume não muda de um trecho para o outro.
// D60-B2: o MP3 gravado passa por masterizar() (limitador), que alcança o alvo
// mesmo quando o pico da fala travaria o nivelar().
//
// Módulo PURO (zero imports).

export const TAXA_GEMINI = 24_000;
export const TAXA_SAIDA = 44_100;

const MAX = 32767;

/** Bytes little-endian (o que vem do base64 da API) → amostras. */
export function pcmDeBytes(bytes: Uint8Array): Int16Array {
  const n = Math.floor(bytes.length / 2);
  const out = new Int16Array(n);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true);
  return out;
}

function db(v: number): number {
  return v > 0 ? 20 * Math.log10(v) : -Infinity;
}

export interface AnaliseAudio {
  duracaoMs: number;
  rmsDb: number;
  picoDb: number;
  /** Amostras no teto (som estourado). */
  clipadas: number;
}

export function analisar(pcm: Int16Array, taxa: number): AnaliseAudio {
  let soma = 0;
  let pico = 0;
  let clipadas = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]);
    soma += pcm[i] * pcm[i];
    if (a > pico) pico = a;
    if (a >= MAX - 1) clipadas++;
  }
  const rms = pcm.length ? Math.sqrt(soma / pcm.length) / MAX : 0;
  return {
    duracaoMs: Math.round((pcm.length / taxa) * 1000),
    rmsDb: Math.round(db(rms) * 10) / 10,
    picoDb: Math.round(db(pico / MAX) * 10) / 10,
    clipadas,
  };
}

/**
 * Corta o silêncio das pontas e os ruídos soltos que o Gemini deixa nelas.
 * Medido em 17/nov em todos os trechos do primeiro livro: um estalo de ~10 ms
 * no começo, seguido de silêncio, e um ruído de ~170 ms uns 300 ms depois da
 * última palavra. Som curto, separado da fala por silêncio, na ponta do
 * trecho, não é fala: sai. Depois deixa uma folga para não comer a primeira
 * sílaba. A pausa entre trechos é posta na montagem, sempre do mesmo tamanho.
 */
export function aparar(pcm: Int16Array, taxa: number, limiarDb = -45, folgaMs = 80): Int16Array {
  const janela = Math.max(1, Math.round(taxa / 100)); // 10 ms
  const limiar = MAX * Math.pow(10, limiarDb / 20);
  const n = Math.ceil(pcm.length / janela);
  const ativa: boolean[] = new Array(n);
  for (let w = 0; w < n; w++) {
    const ini = w * janela;
    const fim = Math.min(pcm.length, ini + janela);
    let s = 0;
    for (let i = ini; i < fim; i++) s += pcm[i] * pcm[i];
    ativa[w] = Math.sqrt(s / Math.max(1, fim - ini)) > limiar;
  }
  // Ilhas de som (em janelas), juntando buracos de até 60 ms.
  const ilhas: { ini: number; fim: number }[] = [];
  for (let w = 0; w < n; w++) {
    if (!ativa[w]) continue;
    const ultima = ilhas[ilhas.length - 1];
    if (ultima && w - ultima.fim <= 6) ultima.fim = w + 1;
    else ilhas.push({ ini: w, fim: w + 1 });
  }
  if (ilhas.length === 0) return new Int16Array(0);
  let a = 0;
  let b = ilhas.length - 1;
  // Começo: estalo de até 60 ms seguido de 100 ms ou mais de silêncio.
  while (a < b && ilhas[a].fim - ilhas[a].ini <= 6 && ilhas[a + 1].ini - ilhas[a].fim >= 10) a++;
  // Fim: ruído de até 220 ms depois de 250 ms ou mais de silêncio.
  while (b > a && ilhas[b].fim - ilhas[b].ini <= 22 && ilhas[b].ini - ilhas[b - 1].fim >= 25) b--;
  const folga = Math.round((folgaMs / 1000) * taxa);
  const inicio = Math.max(0, ilhas[a].ini * janela - folga);
  const fimAmostra = Math.min(pcm.length, ilhas[b].fim * janela + folga);
  return pcm.slice(inicio, fimAmostra);
}

/** Nivela o RMS no alvo sem deixar o pico passar do teto. Devolve o ganho aplicado. */
export function nivelar(pcm: Int16Array, alvoRmsDb = -20, tetoPicoDb = -3): { pcm: Int16Array; ganhoDb: number } {
  const a = analisar(pcm, 1);
  if (!Number.isFinite(a.rmsDb) || !Number.isFinite(a.picoDb)) return { pcm, ganhoDb: 0 };
  const ganhoDb = Math.min(alvoRmsDb - a.rmsDb, tetoPicoDb - a.picoDb);
  const g = Math.pow(10, ganhoDb / 20);
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.round(pcm[i] * g);
    out[i] = v > MAX ? MAX : v < -MAX ? -MAX : v;
  }
  return { pcm: out, ganhoDb: Math.round(ganhoDb * 10) / 10 };
}

function mdc(a: number, b: number): number {
  return b === 0 ? a : mdc(b, a % b);
}

/**
 * Reamostragem polifásica por sinc janelado (Hann, 16 amostras de cada lado).
 * Os coeficientes de cada fase são calculados uma vez (24 -> 44,1 kHz tem 147
 * fases), o que deixa o laço só com multiplicações. Para subir a taxa basta
 * o filtro na metade da taxa de origem.
 */
export function reamostrar(pcm: Int16Array, de: number, para: number): Int16Array {
  if (de === para) return pcm.slice();
  const g = mdc(de, para);
  const sobe = para / g; // fases
  const desce = de / g;
  const meio = 16;
  const largura = meio * 2;
  const corte = 0.95 * Math.min(1, para / de);
  const coef = new Float64Array(sobe * largura);
  for (let f = 0; f < sobe; f++) {
    const frac = f / sobe; // posição dentro da amostra de origem
    for (let j = 0; j < largura; j++) {
      const x = frac - (j - meio + 1);
      const jan = 0.5 * (1 + Math.cos((Math.PI * x) / meio));
      const arg = Math.PI * corte * x;
      coef[f * largura + j] = (x === 0 ? corte : (corte * Math.sin(arg)) / arg) * jan;
    }
  }
  const n = Math.floor((pcm.length * sobe) / desce);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * desce;
    const c = Math.floor(pos / sobe);
    const f = pos - c * sobe;
    const base = f * largura;
    const k0 = c - meio + 1;
    let soma = 0;
    if (k0 >= 0 && k0 + largura <= pcm.length) {
      for (let j = 0; j < largura; j++) soma += pcm[k0 + j] * coef[base + j];
    } else {
      for (let j = 0; j < largura; j++) {
        const k = k0 + j;
        if (k >= 0 && k < pcm.length) soma += pcm[k] * coef[base + j];
      }
    }
    const v = Math.round(soma);
    out[i] = v > MAX ? MAX : v < -MAX ? -MAX : v;
  }
  return out;
}

/** PCM mono 16 bits → arquivo WAV (para mandar o trecho à conferência). */
export function wavDePcm(pcm: Int16Array, taxa: number): Uint8Array {
  const dados = pcm.length * 2;
  const out = new Uint8Array(44 + dados);
  const dv = new DataView(out.buffer);
  const txt = (pos: number, t: string) => { for (let i = 0; i < t.length; i++) out[pos + i] = t.charCodeAt(i); };
  txt(0, "RIFF");
  dv.setUint32(4, 36 + dados, true);
  txt(8, "WAVE");
  txt(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, taxa, true);
  dv.setUint32(28, taxa * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  txt(36, "data");
  dv.setUint32(40, dados, true);
  for (let i = 0; i < pcm.length; i++) dv.setInt16(44 + i * 2, pcm[i], true);
  return out;
}

export function silencio(ms: number, taxa: number): Int16Array {
  return new Int16Array(Math.round((ms / 1000) * taxa));
}

/**
 * D60-B2. Acabamento para as lojas: leva o RMS ao alvo e segura o pico com um
 * limitador com antecipação. nivelar() sozinho para no teto de pico e deixava
 * a fala perto de -23 dB RMS (capítulo medido em -24,3 em 19/nov, abaixo da
 * faixa de -23 a -18 das lojas). O limitador abaixa só os picos curtos: o
 * ganho começa a cair 5 ms antes do pico, em rampa, e volta em ~100 ms, sem
 * estalo. Teto de -4 dBFS na amostra deixa folga para a reamostragem e o MP3.
 * Medido no laboratório (3 capítulos de 19/nov): capítulo final entre -20,4 e
 * -20,9 dB RMS, pico -4,0 dB; redução acima de 3 dB em 1 a 3% da fala.
 */
export function masterizar(
  pcm: Int16Array,
  taxa: number,
  alvoRmsDb = -19.5,
  tetoDb = -4,
  reducaoMaxDb = 9,
): { pcm: Int16Array; ganhoDb: number; reducaoDb: number } {
  const a = analisar(pcm, taxa);
  if (pcm.length === 0 || !Number.isFinite(a.rmsDb) || !Number.isFinite(a.picoDb)) return { pcm, ganhoDb: 0, reducaoDb: 0 };
  // Ganho para o alvo, sem pedir ao limitador mais que reducaoMaxDb nos picos.
  const ganhoDb = Math.min(alvoRmsDb - a.rmsDb, tetoDb - a.picoDb + reducaoMaxDb);
  const g0 = Math.pow(10, ganhoDb / 20);
  const teto = MAX * Math.pow(10, tetoDb / 20);
  const n = pcm.length;
  const L = Math.max(1, Math.round(taxa * 0.005));
  // Ganho necessário em cada amostra (1 = nada a reduzir).
  const req = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.abs(pcm[i]) * g0;
    req[i] = v > teto ? teto / v : 1;
  }
  // Mínimo à frente em [i, i+L) (fila monotônica) e média móvel de L: a rampa
  // de descida termina no próprio pico, então nenhuma amostra passa do teto.
  const minFrente = new Float32Array(n);
  const fila = new Int32Array(n);
  let ini = 0;
  let fim = 0;
  for (let j = n - 1; j >= 0; j--) {
    while (fim > ini && req[fila[fim - 1]] >= req[j]) fim--;
    fila[fim++] = j;
    while (fila[ini] >= j + L) ini++;
    minFrente[j] = req[fila[ini]];
  }
  const volta = 1 - Math.exp(-1 / (taxa * 0.1));
  const out = new Int16Array(n);
  let soma = 0;
  let g = 1;
  let menor = 1;
  for (let i = 0; i < n; i++) {
    soma += minFrente[i];
    if (i >= L) soma -= minFrente[i - L];
    const alvo = soma / Math.min(i + 1, L);
    g = alvo < g ? alvo : g + (alvo - g) * volta;
    if (g < menor) menor = g;
    const v = Math.round(pcm[i] * g0 * g);
    out[i] = v > MAX ? MAX : v < -MAX ? -MAX : v;
  }
  return { pcm: out, ganhoDb: Math.round(ganhoDb * 10) / 10, reducaoDb: Math.round(-20 * Math.log10(menor) * 10) / 10 };
}
