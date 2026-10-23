import type { BridgeProbeError, Classification, EngineFailureReason, FetchFailure, GameRejection } from '../domain/types'

export const CLASSIFICATION_LABEL: Readonly<Record<Classification, string>> = {
  brilliant: 'Brilhante',
  great: 'Ótimo',
  best: 'Melhor',
  excellent: 'Excelente',
  good: 'Bom',
  book: 'Teoria',
  inaccuracy: 'Imprecisão',
  mistake: 'Erro',
  blunder: 'Blunder',
  miss: 'Chance perdida',
}

/** The classifications "próximo erro" stops at. */
export const ERROR_CLASSIFICATIONS: ReadonlySet<Classification> = new Set(['inaccuracy', 'mistake', 'blunder', 'miss'])

export function fetchFailureText(f: FetchFailure, username: string): { title: string; detail: string } {
  switch (f.kind) {
    case 'not-found':
      return { title: `Usuário "${username}" não encontrado`, detail: 'Confira a grafia do nome de usuário e o site escolhido.' }
    case 'rate-limited':
      return {
        title: 'Muitas requisições',
        detail: f.retryAfterS ? `O site pediu para esperar ${f.retryAfterS} s antes de tentar de novo.` : 'O site pediu para esperar um pouco antes de tentar de novo.',
      }
    case 'network':
      return { title: 'Sem conexão com o site', detail: f.detail }
    case 'bad-response':
      return { title: 'Resposta inesperada do site', detail: f.detail }
  }
}

/** The parser's own message is English and technical, so it only goes in `detail`, for a disclosure. */
export function rejectionText(r: GameRejection): { text: string; detail: string | null } {
  switch (r.kind) {
    case 'unparseable': return { text: 'Não deu para ler este PGN. Confira se o texto está completo, com os lances depois dos cabeçalhos.', detail: r.detail }
    case 'variant': return { text: `Variante não suportada (${r.detail}). Só partidas de xadrez clássico podem ser revisadas.`, detail: null }
    case 'no-moves': return { text: 'A partida não tem lances.', detail: null }
  }
}

export function engineFailureText(f: EngineFailureReason): { title: string; detail: string } {
  switch (f.kind) {
    case 'unavailable':
      switch (f.why) {
        case 'needs-cross-origin-isolation':
          return { title: 'Engine indisponível nesta página', detail: 'O Stockfish 19 Completo precisa de uma página com isolamento de origem (COOP/COEP). Escolha o Lite nas configurações ou abra o app pelo servidor do projeto.' }
        case 'bridge-unreachable':
          return { title: 'Bridge fora do ar', detail: 'Não foi possível conectar ao bridge local. Confira a URL nas configurações e se o comando npm run bridge está rodando.' }
        case 'bridge-refused':
          return { title: 'Bridge recusou a conexão', detail: 'O bridge não aceita esta origem. Inicie-o com --origin apontando para este endereço.' }
      }
      break
    case 'mismatch':
      return { title: 'Engine diferente do esperado', detail: `Esperava "${f.expected}" e encontrou "${f.got}". Teste a conexão nas configurações de novo.` }
    case 'crashed':
      return { title: 'A engine travou', detail: f.detail }
    case 'protocol':
      return { title: 'A engine respondeu algo inesperado', detail: f.detail }
    case 'timeout':
      return { title: 'A engine não respondeu a tempo', detail: f.during === 'handshake' ? 'Ela não completou a inicialização.' : 'Ela não terminou a busca.' }
  }
}

export function probeErrorText(e: BridgeProbeError): string {
  switch (e.kind) {
    case 'unreachable': return 'Não foi possível conectar. O bridge está rodando nessa URL?'
    case 'refused': return 'O bridge recusou a conexão desta origem. Inicie-o com --origin para este endereço.'
    case 'not-uci': return `A resposta não parece UCI: ${e.detail}`
  }
}
