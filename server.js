
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 10000;

const produtos = [{
  id: 4814942,
  nome: 'Onde está na Bíblia - Versículos bíblicos contra as heresias modernas',
  plataforma: 'Hotmart',
  linkAfiliado: 'https://go.hotmart.com/F107572734G',
  ativo: true
}];

const cenas = [
  'Você gosta de estudar a Bíblia?',
  'Conheça um material sobre versículos bíblicos',
  'Confira os detalhes no link da descrição'
];

const DURACAO_CENA = 7;
const DURACAO_VIDEO = 21;

function enviarJSON(res, codigo, dados) {
  if (res.headersSent) return;

  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(dados));
}

async function tokenHotmart() {
  const id = process.env.HOTMART_CLIENT_ID;
  const segredo = process.env.HOTMART_CLIENT_SECRET;
  const basic = process.env.HOTMART_BASIC;

  if (!id || !segredo || !basic) {
    throw new Error('Credenciais Hotmart ausentes');
  }

  const parametros = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: id,
    client_secret: segredo
  });

  const resposta = await fetch(
    'https://api-sec-vlc.hotmart.com/security/oauth/token?' +
    parametros.toString(),
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
    throw new Error('Hotmart HTTP ' + resposta.status);
  }

  const dados = await resposta.json();

  if (!dados.access_token) {
    throw new Error('Token Hotmart não recebido');
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
      duracao: '21 segundos',
      cena1: cenas[0],
      cena2: cenas[1],
      cena3: cenas[2]
    }
  };
}

// Fonte desenhada nos pixels.
// Não depende do filtro drawtext.
const FONTE = {
  A: ['01110','10001','10001','11111','10001','10001','10001'],
  B: ['11110','10001','10001','11110','10001','10001','11110'],
  C: ['01111','10000','10000','10000','10000','10000','01111'],
  D: ['11110','10001','10001','10001','10001','10001','11110'],
  E: ['11111','10000','10000','11110','10000','10000','11111'],
  F: ['11111','10000','10000','11110','10000','10000','10000'],
  G: ['01111','10000','10000','10111','10001','10001','01111'],
  H: ['10001','10001','10001','11111','10001','10001','10001'],
  I: ['11111','00100','00100','00100','00100','00100','11111'],
  J: ['00111','00010','00010','00010','10010','10010','01100'],
  K: ['10001','10010','10100','11000','10100','10010','10001'],
  L: ['10000','10000','10000','10000','10000','10000','11111'],
  M: ['10001','11011','10101','10101','10001','10001','10001'],
  N: ['10001','11001','10101','10011','10001','10001','10001'],
  O: ['01110','10001','10001','10001','10001','10001','01110'],
  P: ['11110','10001','10001','11110','10000','10000','10000'],
  Q: ['01110','10001','10001','10001','10101','10010','01101'],
  R: ['11110','10001','10001','11110','10100','10010','10001'],
  S: ['01111','10000','10000','01110','00001','00001','11110'],
  T: ['11111','00100','00100','00100','00100','00100','00100'],
  U: ['10001','10001','10001','10001','10001','10001','01110'],
  V: ['10001','10001','10001','10001','10001','01010','00100'],
  W: ['10001','10001','10001','10101','10101','10101','01010'],
  X: ['10001','10001','01010','00100','01010','10001','10001'],
  Y: ['10001','10001','01010','00100','00100','00100','00100'],
  Z: ['11111','00001','00010','00100','01000','10000','11111'],
  '?': ['01110','10001','00001','00010','00100','00000','00100'],
  '!': ['00100','00100','00100','00100','00100','00000','00100'],
  '.': ['00000','00000','00000','00000','00000','00100','00100'],
  ',': ['00000','00000','00000','00000','00100','00100','01000'],
  ' ': ['00000','00000','00000','00000','00000','00000','00000']
};

function normalizar(texto) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ?!.,]/g, ' ');
}

function dividirTexto(texto, limite = 22) {
  const palavras = normalizar(texto).split(/\s+/);
  const linhas = [];
  let atual = '';

  for (const palavra of palavras) {
    if (!palavra) continue;

    const tentativa = atual
      ? atual + ' ' + palavra
      : palavra;

    if (tentativa.length > limite && atual) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = tentativa;
    }
  }

  if (atual) linhas.push(atual);

  return linhas;
}

function criarImagem(destino, cor, texto) {
  const largura = 720;
  const altura = 1280;
  const escala = 6;

  const pixels = Buffer.alloc(largura * altura * 3);

  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = cor[0];
    pixels[i + 1] = cor[1];
    pixels[i + 2] = cor[2];
  }

  function retangulo(x, y, w, h, rgb) {
    const x1 = Math.max(0, Math.floor(x));
    const y1 = Math.max(0, Math.floor(y));
    const x2 = Math.min(largura, Math.ceil(x + w));
    const y2 = Math.min(altura, Math.ceil(y + h));

    for (let py = y1; py < y2; py++) {
      for (let px = x1; px < x2; px++) {
        const pos = (py * largura + px) * 3;

        pixels[pos] = rgb[0];
        pixels[pos + 1] = rgb[1];
        pixels[pos + 2] = rgb[2];
      }
    }
  }

  function desenharLetra(caractere, x, y) {
    const desenho = FONTE[caractere] || FONTE[' '];

    for (let linha = 0; linha < 7; linha++) {
      for (let coluna = 0; coluna < 5; coluna++) {
        if (desenho[linha][coluna] === '1') {
          retangulo(
            x + coluna * escala,
            y + linha * escala,
            escala,
            escala,
            [255, 255, 255]
          );
        }
      }
    }
  }

  const linhas = dividirTexto(texto);
  const passo = 64;

  const yInicial = Math.floor(
    altura / 2 - linhas.length * passo / 2
  );

  retangulo(
    25,
    yInicial - 35,
    670,
    linhas.length * passo + 55,
    [12, 20, 36]
  );

  linhas.forEach((linha, indice) => {
    const xInicial = Math.floor(
      (largura - linha.length * 36) / 2
    );

    for (let i = 0; i < linha.length; i++) {
      desenharLetra(
        linha[i],
        xInicial + i * 36,
        yInicial + indice * passo
      );
    }
  });

  retangulo(80, 1080, 560, 8, [241, 184, 74]);

  const cabecalho = Buffer.from(
    `P6\n${largura} ${altura}\n255\n`
  );

  fs.writeFileSync(
    destino,
    Buffer.concat([cabecalho, pixels])
  );
}

function executarFFmpeg(argumentos) {
  return new Promise((resolve, reject) => {
    const ffmpeg = require('ffmpeg-static');

    if (!ffmpeg) {
      return reject(
        new Error('FFmpeg não encontrado')
      );
    }

    const processo = spawn(ffmpeg, argumentos);
    let log = '';
    let terminou = false;

    function finalizar(erro) {
      if (terminou) return;
      terminou = true;

      if (erro) reject(erro);
      else resolve();
    }

    processo.stderr.on('data', dados => {
      log = (log + dados.toString()).slice(-5000);
    });

    processo.on('error', finalizar);

    processo.on('close', codigo => {
      if (codigo === 0) {
        finalizar();
      } else {
        finalizar(
          new Error(
            'FFmpeg falhou: ' + log.slice(-1500)
          )
        );
      }
    });
  });
}

// Narração gratuita por HTTP.
// Serviço não oficial, sujeito a bloqueios.
async function criarNarracao(pasta) {
  const texto = cenas.join(' ');

  const parametros = new URLSearchParams({
    ie: 'UTF-8',
    client: 'tw-ob',
    tl: 'pt-BR',
    q: texto
  });

  const url =
    'https://translate.google.com/translate_tts?' +
    parametros.toString();

  console.log('Solicitando narração gratuita');

  const resposta = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'audio/mpeg,*/*'
    },
    signal: AbortSignal.timeout(30000)
  });

  if (!resposta.ok) {
    throw new Error(
      'Serviço de voz respondeu HTTP ' +
      resposta.status
    );
  }

  const tipo = resposta.headers.get('content-type') || '';

  if (
    tipo.includes('text/html') ||
    tipo.includes('application/json')
  ) {
    throw new Error(
      'Serviço de voz retornou texto em vez de áudio'
    );
  }

  const buffer = Buffer.from(
    await resposta.arrayBuffer()
  );

  if (buffer.length < 1000) {
    throw new Error(
      'Áudio não recebido ou arquivo muito pequeno'
    );
  }

  const cabecalhoMP3 =
    buffer.toString('ascii', 0, 3) === 'ID3';

  const quadroMP3 =
    buffer[0] === 0xff &&
    (buffer[1] & 0xe0) === 0xe0;

  if (!cabecalhoMP3 && !quadroMP3) {
    throw new Error(
      'Resposta não parece ser um MP3 válido'
    );
  }

  const arquivo = path.join(pasta, 'narracao.mp3');

  fs.writeFileSync(arquivo, buffer);

  console.log(
    'Narração recebida:',
    buffer.length,
    'bytes'
  );

  return arquivo;
}

async function gerarVideo(voz) {
  const pasta = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rendabot-')
  );

  try {
    const audio = await criarNarracao(pasta);

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

      criarImagem(imagem, cores[i], cenas[i]);

      imagens.push(imagem);
    }

    const lista = path.join(pasta, 'lista.txt');
    const linhas = [];

    for (const imagem of imagens) {
      linhas.push(`file '${imagem}'`);
      linhas.push(`duration ${DURACAO_CENA}`);
    }

    linhas.push(
      `file '${imagens[imagens.length - 1]}'`
    );

    fs.writeFileSync(lista, linhas.join('\n'));

    const arquivo = path.join(pasta, 'video.mp4');

    // A voz base é a mesma.
    // O filtro modifica a altura da voz.
    const frequencia =
      voz === 'masculina' ? 38000 : 47000;

    const filtroAudio =
      `aresample=44100,` +
      `asetrate=${frequencia},` +
      'aresample=44100,' +
      'apad';

    await executarFFmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', lista,
      '-i', audio,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-vf', 'fps=24,format=yuv420p',
      '-af', filtroAudio,
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
      fs.statSync(arquivo).size < 1000
    ) {
      throw new Error('Vídeo MP4 não foi criado');
    }

    console.log('Vídeo criado:', voz);

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
    const url = new URL(req.url, 'http://localhost');
    const rota = url.pathname;

    if (req.method !== 'GET') {
      return enviarJSON(res, 405, {
        erro: 'Método não permitido'
      });
    }

    if (rota === '/' || rota === '/api/health') {
      return enviarJSON(res, 200, {
        status: 'online',
        app: 'RendaBot',
        narracao: 'gratuita experimental',
        vozes: ['feminina', 'masculina']
      });
    }

    if (rota === '/api/status') {
      try {
        await tokenHotmart();

        return enviarJSON(res, 200, {
          status: 'online',
          hotmart: 'conectada',
          token: 'gerado'
        });

      } catch (erro) {
        return enviarJSON(res, 502, {
          status: 'online',
          hotmart: 'erro',
          mensagem: erro.message
        });
      }
    }

    if (rota === '/api/afiliados') {
      return enviarJSON(res, 200, {
        total: produtos.length,
        produtos
      });
    }

    if (rota === '/api/conteudos') {
      const ativos = produtos.filter(p => p.ativo);

      return enviarJSON(res, 200, {
        total: ativos.length,
        conteudos: ativos.map(gerarConteudos)
      });
    }

    if (rota === '/api/products') {
      try {
        const token = await tokenHotmart();

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

        return enviarJSON(
          res,
          resposta.status,
          dados
        );

      } catch (erro) {
        return enviarJSON(res, 502, {
          erro: 'Falha na consulta Hotmart',
          mensagem: erro.message
        });
      }
    }

    if (rota === '/api/video') {
      const voz =
        url.searchParams.get('voz') || 'feminina';

      if (!['feminina', 'masculina'].includes(voz)) {
        return enviarJSON(res, 400, {
          erro: 'Use voz=feminina ou voz=masculina'
        });
      }

      try {
        console.log('Gerando vídeo:', voz);

        const resultado = await gerarVideo(voz);

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
            'Erro no download:',
            erro.message
          );

          res.destroy();
          limpar();
        });

        stream.on('close', limpar);
        stream.pipe(res);
        return;

      } catch (erro) {
        console.error(
          'Erro ao gerar vídeo:',
          erro.stack || erro.message
        );

        return enviarJSON(res, 500, {
          status: 'erro',
          mensagem: 'Não foi possível gerar o vídeo',
          detalhes: erro.message
        });
      }
    }

    return enviarJSON(res, 404, {
      erro: 'Rota não encontrada'
    });

  } catch (erro) {
    console.error('Erro interno:', erro);

    return enviarJSON(res, 500, {
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
  console.log(
    'RendaBot online na porta ' + PORT
  );
});
