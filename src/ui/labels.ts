import type { BridgeProbeError, Classification, EngineFailureReason, FetchFailure, GameRejection, Phase, PuzzleTheme } from '../domain/types'

export const PHASE_LABEL: Readonly<Record<Phase, string>> = { opening: 'Abertura', middlegame: 'Meio de jogo', endgame: 'Final' }

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

export const THEME_LABEL: Readonly<Record<PuzzleTheme, string>> = {
  mateIn1: 'Mate em 1',
  mateIn2: 'Mate em 2',
  mateIn3: 'Mate em 3',
  mateIn4: 'Mate em 4',
  mateIn5: 'Mate em 5 ou mais',
  mate: 'Mate',
  backRankMate: 'Mate no corredor',
  smotheredMate: 'Mate sufocado',
  fork: 'Garfo',
  pin: 'Cravada',
  skewer: 'Espeto',
  discoveredAttack: 'Ataque descoberto',
  discoveredCheck: 'Xeque descoberto',
  doubleCheck: 'Xeque duplo',
  xRayAttack: 'Raio X',
  sacrifice: 'Sacrifício',
  deflection: 'Desvio',
  attraction: 'Atração',
  clearance: 'Abertura de linha',
  interference: 'Interferência',
  intermezzo: 'Lance intermediário',
  capturingDefender: 'Captura do defensor',
  hangingPiece: 'Peça solta',
  trappedPiece: 'Peça presa',
  quietMove: 'Lance silencioso',
  defensiveMove: 'Defesa',
  zugzwang: 'Zugzwang',
  advancedPawn: 'Peão avançado',
  promotion: 'Promoção',
  underPromotion: 'Subpromoção',
  enPassant: 'En passant',
  castling: 'Roque',
  kingsideAttack: 'Ataque na ala do rei',
  queensideAttack: 'Ataque na ala da dama',
  exposedKing: 'Rei exposto',
  attackingF2F7: 'Ataque em f2 ou f7',
  advantage: 'Vantagem',
  crushing: 'Vantagem decisiva',
  equality: 'Igualdade',
  opening: 'Abertura',
  middlegame: 'Meio de jogo',
  endgame: 'Final',
  pawnEndgame: 'Final de peões',
  rookEndgame: 'Final de torres',
  bishopEndgame: 'Final de bispos',
  knightEndgame: 'Final de cavalos',
  queenEndgame: 'Final de damas',
  queenRookEndgame: 'Final de dama e torre',
}

/** The classifications "próximo erro" stops at. */
export const ERROR_CLASSIFICATIONS: ReadonlySet<Classification> = new Set(['inaccuracy', 'mistake', 'blunder', 'miss'])

/** `technical` is the raw English detail from the network or the site, for a disclosure only. */
export function fetchFailureText(f: FetchFailure, username: string): { title: string; text: string; technical: string | null } {
  switch (f.kind) {
    case 'not-found':
      return { title: `Usuário "${username}" não encontrado`, text: 'Confira a grafia do nome de usuário e o site escolhido.', technical: null }
    case 'rate-limited':
      return {
        title: 'Muitas requisições',
        text: f.retryAfterS ? `O site pediu para esperar ${f.retryAfterS} s antes de tentar de novo.` : 'O site pediu para esperar um pouco antes de tentar de novo.',
        technical: null,
      }
    case 'network':
      return { title: 'Sem conexão com o site', text: 'Não deu para falar com o site. Confira sua conexão com a internet e tente de novo.', technical: f.detail }
    case 'bad-response':
      return { title: 'Resposta inesperada do site', text: 'O site respondeu de um jeito que o app não entende. Tente de novo em instantes.', technical: f.detail }
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

/** The chess-book annotation each class prints after the move. Routine moves print none. */
export const CLASSIFICATION_MARK: Readonly<Record<Classification, string>> = {
  brilliant: '!!',
  great: '!',
  best: '',
  excellent: '',
  good: '',
  book: '',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
  miss: '×',
}
