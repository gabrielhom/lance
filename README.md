# Lance

Revisão de partidas de xadrez no navegador. Você cola um PGN ou busca suas partidas no Lichess ou no Chess.com, e o Stockfish 19 analisa cada posição. O app mostra sua precisão, classifica cada lance (brilhante, ótimo, melhor, excelente, bom, teoria, imprecisão, erro, blunder, chance perdida) e diz qual era o melhor lance e a melhor sequência. As revisões ficam salvas no navegador e o histórico mostra sua precisão ao longo do tempo.

## Rodar

```sh
npm install
npm run dev
```

O `npm install` copia o Stockfish 19 (WASM) para `public/engine`. Abra http://localhost:5173 e, em Configurações, informe seus usuários do Lichess e do Chess.com para o app saber de que lado você jogou.

## Engines

- **Stockfish 19 Lite.** O padrão. Roda vários workers de uma thread em paralelo, um por posição. Baixa 1,8 MB.
- **Stockfish 19 Completo.** A rede neural completa, 99 MB. Usa várias threads e por isso precisa de uma página com isolamento de origem (`Cross-Origin-Opener-Policy` e `Cross-Origin-Embedder-Policy`). O `vite dev` e o `vite preview` já mandam esses cabeçalhos. Em outro servidor, configure os dois.
- **Engine local.** Qualquer engine UCI instalada na máquina (Stockfish nativo, Lc0, Berserk etc.) através de uma ponte WebSocket:

  ```sh
  npm run bridge -- --engine sf19=/caminho/para/stockfish --engine lc0=/caminho/para/lc0
  ```

  A ponte só escuta em 127.0.0.1, só aceita páginas das origens permitidas (`--origin` acrescenta outras) e só roda os executáveis passados na linha de comando. Em Configurações, escolha "Engine local", informe `http://127.0.0.1:7777` e clique em Testar.

  O Stockfish nativo é bem mais rápido que o WASM. Os binários oficiais estão em https://github.com/official-stockfish/Stockfish/releases.

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
- `src/review`: orquestra a análise de uma partida.
- `src/ui`: a interface em React.
- `bridge/server.mjs`: a ponte para engines nativas.
