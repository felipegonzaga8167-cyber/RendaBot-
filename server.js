
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 10000;

const produtos = [
  {
    id: 4814942,
    nome: 'Onde está na Bíblia - Versículos bíblicos contra as heresias modernas',
    plataforma: 'Hotmart',
    linkAfiliado: 'https://go.hotmart.com/F107572734G',
    ativo: true
  }
];

const cenas = [
  'Você gosta de estudar a Bíblia?',
  'Conheça um material sobre versículos bíblicos',
  'Confira os detalhes no link da descrição'
];

const DURACAO_CENA = 7;
const DURACAO_VIDEO = DURACAO_CENA * cenas.length;

function sendJSON(res, status, dados) {
  if (res.headersSent) return;

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(dados));
}

async function getHotmartToken() {
  const clientId = process.env.HOTMART_CLIENT_ID;
  const clientSecret = process.env.HOTMART_CLIENT_SECRET;
  const basic = process.env.HOTMART_BASIC;

  if (!clientId || !clientSecret || !basic) {
    throw new Error('Credenciais Hotmart não configuradas');
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  });

  const resposta = await fetch(
    'https://api-sec-vlc.hotmart.com/security/oauth/token?' +
      params.toString(),
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      signal: AbortSignal.timeout(20000)
    }
  );

  if (!resposta.ok) {
    throw new Error(`Hotmart HTTP ${resposta.status}`);
  }

  const dados = await resposta.json();

  if (!dados.access_token) {
    throw new Error('Token Hotmart não retornado');
  }

  return dados.access_token;
}

function gerarConteudos(produto) {
  return {
    produto: produto.nome,
    link: produto.linkAfiliado,
    aviso: 'Publicidade com link de afiliado',
    legenda:
      `Conheça "${produto.nome}". ` +
      `Confira: ${produto.linkAfiliado} ` +
      '#Publicidade #LinkDeAfiliado',
    roteiroVideo: {
      formato: 'Vertical, sem mostrar o rosto',
      duracao: `${DURACAO_VIDEO} segundos`,
      cena1: cenas[0],
      cena2: cenas[1],
      cena3: cenas[2]
    }
  };
}

// Fonte simples desenhada diretamente nos pixels.
// Não precisa de fontes instaladas nem do filtro drawtext.
const LETRAS = {
  'A': ['01110','10001','10001','11111','10001','10001','10001'],
  'B': ['11110','10001','10001','11110','10001','10001','11110'],
  'C': ['01111','10000','10000','10000','10000','10000','01111'],
  'D': ['11110','10001','10001','10001','10001','10001','11110'],
  'E': ['11111','10000','10000','11110','10000','10000','11111'],
  'F': ['11111','10000','10000','11110','10000','10000','10000'],
  'G': ['01111','10000','10000','10111','10001','10001','01111'],
  'H': ['10001','10001','10001','11111','10001','10001','10001'],
  'I': ['11111','00100','00100','00100','00100','00100','11111'],
  'J': ['00111','00010','00010','00010','10010','10010','01100'],
  'K': ['10001','10010','10100','11000','10100','10010','10001'],
  'L': ['10000','10000','10000','10000','10000','10000','11111'],
  'M': ['10001','11011','10101','10101','10001','10001','10001'],
  'N': ['10001','11001','10101','10011','10001','10001','10001'],
  'O': ['01110','10001','10001','10001','10001','10001','01110'],
  'P': ['11110','10001','10001','11110','10000','10000','10000'],
  'Q': ['01110','10001','10001','10001','10101','10010','01101'],
  'R': ['11110','10001','10001','11110','10100','10010','10001'],
  'S': ['01111','10000','10000','01110','00001','00001','11110'],
  'T': ['11111','00100','00100','00100','00100','00100','00100'],
  'U': ['10001','10001','10001','10001','10001','10001','01110'],
  'V': ['10001','10001','10001','10001','10001','01010','00100'],
  'W': ['10001','10001','10001','10101','10101','10101','01010'],
  'X': ['10001','10001','01010','00100','01010','10001','10001'],
  'Y': ['10001','10001','01010','00100','00100','00100','00100'],
  'Z': ['11111','00001','00010','00100','01000','10000','11111'],
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','10000','11110','00001','00001','11110'],
  '6': ['01111','10000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00001','11110'],
  '?': ['01110','10001','00001','00010','00100','00000','00100'],
  '!': ['00100','00100','00100','00100','00100','00000','00100'],
  '.': ['00000','00000','00000','00000','00000','00100','00100'],
  ',': ['00000','00000','00000','00000','00100','00100','01000'],
  '-': ['00000','00000','00000','11111','00000','00000','00000'],
  ':': ['00000','00100','00100','00000','00100','00100','00000'],
  ' ': ['00000','00000','00000','00000','00000','00000','00000']
};

function normalizarTexto(texto) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ?!.,:-]/g, ' ');
}

function quebrarLinhas(texto, maximo = 22) {
  const palavras = normalizarTexto(texto).split(/\s+/);
  const linhas = [];
  let atual = '';

  for (const palavra of palavras) {
    if (!palavra) continue;

    const tentativa = atual
      ? `${atual} ${palavra}`
      : palavra;

    if (tentativa.length > maximo && atual) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = tentativa;
    }
  }

  if (atual) linhas.push(atual);

  return linhas;
}

function criarImagemPPM(destino, cor, texto) {
  const largura = 720;
  const altura = 1280;
  const escala = 6;

  const pixels = Buffer.alloc(largura * altura * 3);

  // Fundo colorido.
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = cor[0];
    pixels[i + 1] = cor[1];
    pixels[i + 2] = cor[2];
  }

  function retangulo(x, y, w, h, rgb) {
    const inicioX = Math.max(0, Math.floor(x));
    const inicioY = Math.max(0, Math.floor(y));
    const fimX = Math.min(largura, Math.ceil(x + w));
    const fimY = Math.min(altura, Math.ceil(y + h));

    for (let py = inicioY; py < fimY; py++) {
      for (let px = inicioX; px < fimX; px++) {
        const i = (py * largura + px) * 3;
        pixels[i] = rgb[0];
        pixels[i + 1] = rgb[1];
        pixels[i + 2] = rgb[2];
      }
    }
  }

  function desenharLetra(letra, x, y, rgb) {
    const desenho = LETRAS[letra] || LETRAS[' '];

    for (let linha = 0; linha < 7; linha++) {
      for (let coluna = 0; coluna < 5; coluna++) {
        if (desenho[linha][coluna] === '1') {
          retangulo(
            x + coluna * escala,
            y + linha * escala,
            escala,
            escala,
            rgb
          );
        }
      }
    }
  }

  const linhas = quebrarLinhas(texto);
  const alturaLinha = 64;
  const inicioY =
    Math.floor(altura / 2 - linhas.length * alturaLinha / 2);

  // Faixa escura atrás do texto.
  retangulo(
    25,
    inicioY - 35,
    largura - 50,
    linhas.length * alturaLinha + 55,
    [12, 20, 36]
  );

  linhas.forEach((linha, indice) => {
    const larguraLetra = 6 * escala;
    const larguraTexto = linha.length * larguraLetra;
    const inicioX = Math.floor(
      (largura - larguraTexto) / 2
    );

    for (let i = 0; i < linha.length; i++) {
      desenharLetra(
        linha[i],
        inicioX + i * larguraLetra,
        inicioY + indice * alturaLinha,
        [255, 255, 255]
      );
    }
  });

  // Pequena faixa decorativa.
  retangulo(80, 1080, 560, 8, [241, 184, 74]);

  const cabecalho = Buffer.from(
    `P6\n${largura} ${altura}\n255\n`
  );

  fs.writeFileSync(
    destino,
    Buffer.concat([cabecalho, pixels])
  );
}

function executarFFmpeg(args) {
  return new Promise((resolve, reject) => {
    // Carregamento somente quando o vídeo for solicitado.
    const ffmpeg = require('ffmpeg-static');

    if (!ffmpeg) {
      return reject(
        new Error('Executável FFmpeg não encontrado')
      );
    }

    const processo = spawn(ffmpeg, args);
    let detalhes = '';
    let finalizado = false;

    function concluir(erro) {
      if (finalizado) return;
      finalizado = true;

      if (erro) reject(erro);
      else resolve();
    }

    processo.stderr.on('data', dados => {
      detalhes = (
        detalhes + dados.toString()
      ).slice(-4000);
    });

    processo.on('error', concluir);

    processo.on('close', codigo => {
      if (codigo === 0) {
        concluir();
      } else {
        concluir(
          new Error(
            `FFmpeg falhou (${codigo}): ` +
            detalhes.slice(-1200)
          )
        );
      }
    });
  });
}

async function gerarVideo(voz) {
  const pasta = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rendabot-')
  );

  const arquivo = path.join(pasta, 'video.mp4');

  try {
    const { EdgeTTS } = require('node-edge-tts');

    if (typeof EdgeTTS !== 'function') {
      throw new Error('Biblioteca de narração incompatível');
    }

    const vozSelecionada =
      voz === 'masculina'
        ? 'pt-BR-AntonioNeural'
        : 'pt-BR-FranciscaNeural';

    const audio = path.join(pasta, 'narracao.mp3');

    const tts = new EdgeTTS({
      voice: vozSelecionada,
      lang: 'pt-BR',
      timeout: 30000
    });

    await tts.ttsPromise(
      cenas.join(' '),
      audio
    );

    if (
      !fs.existsSync(audio) ||
      fs.statSync(audio).size === 0
    ) {
      throw new Error('O serviço de voz não gerou áudio');
    }

    const cores = [
      [20, 33, 61],
      [29, 53, 87],
      [43, 70, 105]
    ];

    const imagens = [];

    for (let i = 0; i < cenas.length; i++) {
      const imagem = path.join(
        pasta,
        `cena${i + 1}.ppm`
      );

      criarImagemPPM(
        imagem,
        cores[i],
        cenas[i]
      );

      imagens.push(imagem);
    }

    const lista = path.join(pasta, 'lista.txt');

    const conteudoLista = [];

    for (const imagem of imagens) {
      conteudoLista.push(`file '${imagem}'`);
      conteudoLista.push(
        `duration ${DURACAO_CENA}`
      );
    }

    // O concat precisa repetir o último arquivo.
    conteudoLista.push(
      `file '${imagens[imagens.length - 1]}'`
    );

    fs.writeFileSync(
      lista,
      conteudoLista.join('\n')
    );

    await executarFFmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', lista,
      '-i', audio,
      '-vf', 'fps=24,format=yuv420p',
      '-t', String(DURACAO_VIDEO),
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      arquivo
    ]);

    if (
      !fs.existsSync(arquivo) ||
      fs.statSync(arquivo).size === 0
    ) {
      throw new Error('Arquivo de vídeo não foi criado');
    }

    return { pasta, arquivo };

  } catch (erro) {
    fs.rmSync(pasta, {
      recursive: true,
      force: true
    });

    throw erro;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url,
      'http://localhost'
    );

    const rota = url.pathname;

    if (req.method !== 'GET') {
      return sendJSON(res, 405, {
        erro: 'Método não permitido'
      });
    }

    if (rota === '/') {
      return sendJSON(res, 200, {
        app: 'RendaBot',
        status: 'online',
        produtosCadastrados: produtos.length,
        video: '/api/video?voz=feminina',
        vozes: ['feminina', 'masculina']
      });
    }

    if (rota === '/api/health') {
      return sendJSON(res, 200, {
        status: 'online',
        porta: PORT
      });
    }

    if (rota === '/api/status') {
      try {
        await getHotmartToken();

        return sendJSON(res, 200, {
          status: 'online',
          hotmart: 'conectada',
          token: 'gerado'
        });

      } catch (erro) {
        return sendJSON(res, 502, {
          status: 'online',
          hotmart: 'erro',
          mensagem: erro.message
        });
      }
    }

    if (rota === '/api/products') {
      try {
        const token = await getHotmartToken();

        const resposta = await fetch(
          'https://developers.hotmart.com/products/api/v1/products?max_results=50',
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json'
            },
            signal: AbortSignal.timeout(20000)
          }
        );

        const corpo = await resposta.text();

        let dados;

        try {
          dados = JSON.parse(corpo);
        } catch {
          dados = {
            mensagem: corpo.slice(0, 500)
          };
        }

        return sendJSON(
          res,
          resposta.status,
          dados
        );

      } catch (erro) {
        return sendJSON(res, 502, {
          erro: 'Falha na consulta Hotmart',
          mensagem: erro.message
        });
      }
    }

    if (rota === '/api/afiliados') {
      return sendJSON(res, 200, {
        total: produtos.length,
        produtos
      });
    }

    if (rota === '/api/conteudos') {
      const ativos = produtos.filter(
        produto => produto.ativo
      );

      return sendJSON(res, 200, {
        total: ativos.length,
        conteudos: ativos.map(gerarConteudos)
      });
    }

    if (rota === '/api/video') {
      const voz =
        url.searchParams.get('voz') || 'feminina';

      if (
        voz !== 'feminina' &&
        voz !== 'masculina'
      ) {
        return sendJSON(res, 400, {
          erro: 'Escolha feminina ou masculina'
        });
      }

      try {
        console.log(
          `Iniciando geração de vídeo: ${voz}`
        );

        const resultado = await gerarVideo(voz);

        console.log('Vídeo gerado com sucesso');

        const tamanho = fs.statSync(
          resultado.arquivo
        ).size;

        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Disposition':
            `attachment; filename="rendabot-${voz}.mp4"`,
          'Content-Length': tamanho,
          'Cache-Control': 'no-store'
        });

        let removido = false;

        function limpar() {
          if (removido) return;
          removido = true;

          fs.rmSync(resultado.pasta, {
            recursive: true,
            force: true
          });
        }

        const stream = fs.createReadStream(
          resultado.arquivo
        );

        stream.on('error', erro => {
          console.error(
            'Erro na transmissão:',
            erro.message
          );

          res.destroy();
          limpar();
        });

        stream.on('close', limpar);

        return stream.pipe(res);

      } catch (erro) {
        console.error(
          'Erro ao gerar vídeo:',
          erro.stack || erro.message
        );

        return sendJSON(res, 500, {
          status: 'erro',
          mensagem: 'Não foi possível gerar o vídeo',
          detalhes: erro.message
        });
      }
    }

    return sendJSON(res, 404, {
      erro: 'Rota não encontrada'
    });

  } catch (erro) {
    console.error(
      'Erro na requisição:',
      erro.stack || erro.message
    );

    return sendJSON(res, 500, {
      erro: 'Erro interno do RendaBot'
    });
  }
});

server.on('error', erro => {
  console.error(
    'Erro ao iniciar servidor:',
    erro.message
  );
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('================================');
  console.log('RendaBot iniciado com sucesso');
  console.log(`Porta: ${PORT}`);
  console.log('Servidor pronto para receber acessos');
  console.log('================================');
});
