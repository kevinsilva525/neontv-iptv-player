# NEONTV · Player IPTV

Player IPTV web com visual futurista (neon), feito em HTML, CSS e JavaScript puro, sem build.

## Recursos
- Carrega playlists **M3U/M3U8** por URL, arquivo local ou texto colado
- Separação automática em **Canais**, **Filmes** e **Séries**
- Séries agrupadas por título, com seleção de temporada e episódio
- Categorias na lateral, busca, favoritos e paginação para listas grandes
- Reprodução HLS (hls.js) e MP4/MKV, PiP, tela cheia, anterior/próximo
- Atalhos: `Espaço` play/pause, `F` tela cheia, `M` mudo, `←/→` ±10s, `N/P` próximo/anterior
- A última playlist fica salva no navegador

## Como usar
Abra `index.html` em um servidor estático (ex.: `python3 -m http.server`) ou publique no GitHub Pages
(Settings → Pages → branch `main`).

## Observações
- Este projeto é só o player: não inclui nenhuma lista de canais. Use apenas conteúdo ao qual você tem direito.
- Alguns servidores bloqueiam acesso via navegador (CORS). Nesse caso, baixe o `.m3u` e carregue como arquivo.
- Em páginas HTTPS (GitHub Pages), streams `http://` podem ser bloqueados pelo navegador (conteúdo misto).
