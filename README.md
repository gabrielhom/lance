# Lance

Xadrez no navegador contra o Stockfish 19, com revisão de cada partida no fim. Você joga, e o app mostra sua precisão, classifica cada lance (brilhante, ótimo, melhor, excelente, bom, teoria, imprecisão, erro, blunder, chance perdida) e diz qual era o melhor lance e a melhor sequência. Também revisa partidas de fora, coladas como PGN ou buscadas no Lichess e no Chess.com. As revisões ficam salvas no navegador e o histórico mostra sua precisão ao longo do tempo.

## Jogar

- **Contra a engine.** Dez níveis, de Iniciante a Máximo. Os dois mais fracos usam o Skill Level do Stockfish e não têm rating calibrado. Do Clube (~1400) ao Elite (~3190) o nível fixa o `UCI_Elo`. O Máximo joga com força total. Você escolhe brancas, pretas ou aleatório e pode desfazer o último lance.
- **Relógio.** Sem relógio, 3+2, 5+0, 10+0, 15+10 ou 30+0. Quem fica sem tempo perde. Se o outro lado não tiver material para dar mate, é empate.
- **Dois jogadores neste aparelho.** Sem engine. Vocês passam o aparelho a cada lance, e a revisão conta como sua o lado que estava embaixo no tabuleiro.

A partida em andamento sobrevive a um recarregamento, com os relógios onde estavam. No fim, a revisão começa sozinha e mostra a precisão dos dois lados. Ela continua rodando se você pedir revanche ou começar outra partida, e a partida vai para a biblioteca e para o histórico quando a revisão termina. Partidas jogadas aqui contam como suas sem nenhuma conta configurada.

## Rodar

```sh
npm install
npm run dev
```

O `npm install` copia o Stockfish 19 (WASM) para `public/engine/<versão do pacote>`. Abra http://localhost:5173 e jogue. Para revisar partidas do Lichess, do Chess.com ou de um PGN, informe seus usuários em Configurações para o app saber de que lado você jogou nelas.

## Instalar

No Chrome ou no Edge, clique em "Instalar o Lance" em Configurações, ou no ícone de instalar na barra de endereço. O Lance passa a abrir numa janela própria, com ícone como um programa do computador.

Depois da primeira visita ele abre sem internet. A engine fica guardada depois de carregar uma vez, então dá para jogar e revisar offline. Buscar partidas no Lichess e no Chess.com continua precisando de internet. Quem guarda tudo é o service worker em `public/sw.js`, registrado só no build de produção (`npm run build`), nunca no `npm run dev`. Os ícones saem de `public/favicon.svg` com `node scripts/build-icons.mjs`.

## Engines

- **Stockfish 19 Lite.** O padrão. Roda vários workers de uma thread em paralelo, um por posição. Baixa 1,8 MB.
- **Stockfish 19 Completo.** A rede neural completa, 99 MB. Usa várias threads e por isso precisa de uma página com isolamento de origem (`Cross-Origin-Opener-Policy` e `Cross-Origin-Embedder-Policy`). O `vite dev` e o `vite preview` já mandam esses cabeçalhos. Em outro servidor, configure os dois.
- **Engine local.** Qualquer engine UCI instalada na máquina (Stockfish nativo, Lc0, Berserk etc.) através de uma ponte WebSocket:

  ```sh
  npm run bridge -- --engine sf19=/caminho/para/stockfish --engine lc0=/caminho/para/lc0
  ```

  A ponte só escuta em 127.0.0.1, só aceita páginas das origens permitidas (`--origin` acrescenta outras) e só roda os executáveis passados na linha de comando. Em Configurações, escolha "Engine local", informe `http://127.0.0.1:7777` e clique em Testar.

  A ponte também recusa qualquer comando UCI que o app não envia (só `setoption` de Threads, Hash, MultiPV, UCI_Elo, UCI_LimitStrength e Skill Level, mais `position`, `go` e os comandos simples), aceita no máximo 8 engines ao mesmo tempo e fecha a conexão que mandar algo fora disso. Para usá-la a partir do site publicado, acrescente `--origin https://lance-steel-ten.vercel.app`. O Chrome e o Firefox permitem que uma página https abra `ws://127.0.0.1`.

  O Stockfish nativo é bem mais rápido que o WASM. Os binários oficiais estão em https://github.com/official-stockfish/Stockfish/releases.

A mesma engine escolhida em Configurações joga e revisa. Para jogar ela roda em workers separados dos da análise.

Cada avaliação fica em cache no IndexedDB, por engine, profundidade e posição. Reabrir uma partida já revisada não liga a engine.

## Como a precisão é calculada

A precisão segue a fórmula pública do Lichess (`AccuracyPercent.scala`). A avaliação vira chance de vitória, cada lance recebe uma nota pela chance perdida e a nota da partida é a média entre a média ponderada pela volatilidade e a média harmônica. Um teste compara o resultado com a precisão que o próprio Lichess publica para 5 partidas reais e bate no inteiro nas 5.

A classificação usa a chance de vitória perdida no lance, do ponto de vista de quem jogou:

| Classificação | Regra |
|---|---|
| Teoria | Ainda na base de aberturas do Lichess, sem ter saído dela antes |
| Brilhante | Melhor lance da engine, com sacrifício de pelo menos uma peça menor, terminando com 45% ou mais, quando a segunda opção não passava de 90% |
| Ótimo | Melhor lance com 20 pontos ou mais de vantagem sobre a segunda opção, sem ser recaptura nem fuga de peça atacada |
| Melhor | O primeiro lance da engine, ou o único lance legal |
| Chance perdida | O adversário tinha acabado de errar (ou havia mate forçado) e você devolveu 5 pontos ou mais |
| Excelente, Bom, Imprecisão, Erro, Blunder | Perdeu menos de 2, 5, 10 ou 20 pontos, ou 20 ou mais |

Os limiares ficam num único objeto, `CLASSIFIER`, em `src/analysis/classify.ts`.

## Testes

```sh
npm test          # unitários (vitest)
npm run e2e       # ponta a ponta com Stockfish real (Playwright)
```

O e2e usa a engine nativa em `engines/stockfish-19` para testar a ponte e pula esse teste se o arquivo não existir. Se o Chromium do Playwright não abrir na sua máquina, passe um Chrome já aberto com `--remote-debugging-port`: `CDP_URL=http://127.0.0.1:9333 npm run e2e`.

## Código

- `src/domain`: tipos e a construção da partida a partir do PGN.
- `src/analysis`: precisão, classificação, momentos-chave e montagem da revisão. Funções puras.
- `src/engine`: protocolo UCI, workers, pool e a conexão com a ponte.
- `src/storage`: IndexedDB e configurações.
- `src/import`: PGN, Lichess e Chess.com.
- `src/play`: as regras da partida jogada aqui, relógios, níveis, PGN e a partida em andamento salva.
- `src/review`: orquestra a análise de uma partida e o histórico de precisão.
- `src/ui`: a interface em React.
- `bridge/server.mjs`: a ponte para engines nativas.
