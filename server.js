
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { EdgeTTS } = require('node-edge-tts');

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

function sendJSON(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

async function getHotmartToken() {
  const {
    HOTMART_CLIENT_ID: clientId,
    HOTMART_CLIENT_SECRET: clientSecret,
    HOTMART_BASIC: basic
  } = process.env;

  if (!clientId || !clientSecret || !basic) {
    throw new Error('Credenciais Hotmart não configuradas');
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  });

  const response = await fetch(
    `https://api-sec-vlc.hotmart.com/security/oauth/token?${params}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Hotmart HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error('Token não retornado');
  }

  return data.access_token;
}

function gerarConteudos(produto) {
  return {
    produto: produto.nome,
    link: produto.linkAfiliado,
    aviso: 'Publicidade com link de afiliado',
    legenda:
      `Conheça o material "${produto.nome}". ` +
      `Confira: ${produto.linkAfiliado} ` +
      '#Publicidade #LinkDeAfiliado',
    roteiroVideo: {
      formato: 'Vertical, sem mostrar o rosto',
      duracao: '15 segundos',
      cena1: cenas[0],
      cena2: cenas[1],
      cena3: cenas[2]
    }
  };
}

function criarImagemPPM(destino, largura, altura, cor) {
  const cabecalho = Buffer.from(
    `P6\n${largura} ${altura}\n255\n`
  );

  const pixels = Buffer.alloc(largura * altura * 3);

  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = cor[0];
    pixels[i + 1] = cor[1];
    pixels[i + 2] = cor[2];
  }

  fs.writeFileSync(
    destino,
    Buffer.concat([cabecalho, pixels])
  );
}

function executarFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const processo = spawn(ffmpeg, args);
    let erro = '';

    processo.stderr.on('data', dados => {
      erro = (erro + dados.toString()).slice(-3000);
    });

    processo.on('error', reject);

    processo.on('close', codigo => {
      if (codigo === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `FFmpeg (${codigo}): ${erro.slice(-500)}`
          )
        );
      }
    });
  });
}

function textoParaFiltro(texto) {
  return texto
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

async function gerarVideo(voz) {
  const pasta = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rendabot-')
  );

  const arquivo = path.join(pasta, 'video.mp4');

  try {
    const audio = path.join(pasta, 'narracao.mp3');

    const tts = new EdgeTTS({
      voice: voz === 'masculina'
        ? 'pt-BR-AntonioNeural'
        : 'pt-BR-FranciscaNeural'
    });

    await tts.ttsPromise(
      cenas.join('. '),
      audio
    );

    if (
      !fs.existsSync(audio) ||
      fs.statSync(audio).size === 0
    ) {
      throw new Error('Narração não gerou áudio');
    }

    const fontes = [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf'
    ];

    const fonte = fontes.find(fs.existsSync);

    if (!fonte) {
      throw new Error(
        'Fonte para textos não encontrada no servidor'
      );
    }

    const cores = [
      [20, 33, 61],
      [29, 53, 87],
      [43, 70, 105]
    ];

    const arquivos = cores.map((cor, i) => {
      const destino = path.join(
        pasta,
        `cena${i + 1}.ppm`
      );

      criarImagemPPM(
        destino,
        720,
        1280,
        cor
      );

      return destino;
    });

    const lista = path.join(pasta, 'cenas.txt');

    fs.writeFileSync(
      lista,
      [
        `file '${arquivos[0]}'`,
        'duration 5',
        `file '${arquivos[1]}'`,
        'duration 5',
        `file '${arquivos[2]}'`,
        'duration 5',
        `file '${arquivos[2]}'`
      ].join('\n')
    );

    const filtros = cenas.map((texto, i) =>
      `drawtext=fontfile=${fonte}:` +
      `text='${textoParaFiltro(texto)}':` +
      'fontcolor=white:' +
      'fontsize=32:' +
      'box=1:' +
      'boxcolor=black@0.55:' +
      'boxborderw=16:' +
      'x=(w-text_w)/2:' +
      'y=(h-text_h)/2:' +
      `enable='between(t,${i * 5},${(i + 1) * 5})'`
    ).join(',');

    await executarFFmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', lista,
      '-i', audio,
      '-vf', `fps=24,${filtros},format=yuv420p`,
      '-t', '15',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      arquivo
    ]);

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
  const url = new URL(
    req.url,
    'http://localhost'
  );

  const rota = url.pathname;

  if (req.method !== 'GET') {
    return sendJSON(res, 405, {
      error: 'Método não permitido'
    });
  }

  if (rota === '/') {
    return sendJSON(res, 200, {
      status: 'online',
      app: 'RendaBot',
      produtosCadastrados: produtos.length,
      gerarVideo: 'disponível',
      vozes: ['feminina', 'masculina']
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
        status: 'erro',
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
          }
        }
      );

      return sendJSON(
        res,
        resposta.status,
        await resposta.json()
      );

    } catch (erro) {
      return sendJSON(res, 502, {
        status: 'erro',
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
      p => p.ativo
    );

    return sendJSON(res, 200, {
      total: ativos.length,
      conteudos: ativos.map(gerarConteudos)
    });
  }

  if (rota === '/api/video') {
    const voz =
      url.searchParams.get('voz') || 'feminina';

    if (!['feminina', 'masculina'].includes(voz)) {
      return sendJSON(res, 400, {
        erro: 'Use voz=feminina ou voz=masculina'
      });
    }

    try {
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

      const limpar = () => {
        fs.rmSync(resultado.pasta, {
          recursive: true,
          force: true
        });
      };

      const stream = fs.createReadStream(
        resultado.arquivo
      );

      stream.on('error', () => {
        res.destroy();
        limpar();
      });

      stream.on('close', limpar);
      res.on('close', limpar);

      return stream.pipe(res);

    } catch (erro) {
      return sendJSON(res, 500, {
        status: 'erro',
        mensagem: 'Não foi possível gerar vídeo narrado',
        detalhes: erro.message
      });
    }
  }

  return sendJSON(res, 404, {
    error: 'Rota não encontrada'
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`RendaBot online na porta ${PORT}`);
});
