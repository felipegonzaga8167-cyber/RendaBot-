
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ffmpeg = require('ffmpeg-static');

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

function sendJSON(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(payload));
}

async function getHotmartToken() {
  const clientId = process.env.HOTMART_CLIENT_ID;
  const clientSecret = process.env.HOTMART_CLIENT_SECRET;
  const basic = process.env.HOTMART_BASIC;

  if (!clientId || !clientSecret || !basic) {
    throw new Error('Credenciais da Hotmart não configuradas');
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  });

  const response = await fetch(
    `https://api-sec-vlc.hotmart.com/security/oauth/token?${params.toString()}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `Falha na autenticação Hotmart: HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error('Hotmart não retornou token');
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
      `Confira os detalhes: ${produto.linkAfiliado} ` +
      '#Publicidade #LinkDeAfiliado',
    roteiroVideo: {
      formato: 'Vertical, sem mostrar o rosto',
      duracao: '15 segundos',
      cena1: 'Você gosta de estudar a Bíblia?',
      cena2: 'Conheça um material sobre versículos bíblicos',
      cena3: 'Confira os detalhes no link da descrição'
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

function gerarVideo() {
  return new Promise((resolve, reject) => {
    const pasta = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rendabot-')
    );

    const arquivo = path.join(pasta, 'video.mp4');

    const limpar = () => {
      fs.rmSync(pasta, {
        recursive: true,
        force: true
      });
    };

    try {
      const cores = [
        [20, 33, 61],
        [29, 53, 87],
        [43, 70, 105]
      ];

      const arquivos = cores.map((cor, indice) => {
        const nome = path.join(
          pasta,
          `cena${indice + 1}.ppm`
        );

        criarImagemPPM(nome, 720, 1280, cor);

        return nome;
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

      const args = [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', lista,
        '-vf', 'fps=24,format=yuv420p',
        '-t', '15',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-movflags', '+faststart',
        arquivo
      ];

      const processo = spawn(ffmpeg, args);

      let stderr = '';
      let finalizado = false;

      const falhar = (error) => {
        if (finalizado) return;

        finalizado = true;
        limpar();
        reject(error);
      };

      processo.stderr.on('data', chunk => {
        stderr = (
          stderr + chunk.toString()
        ).slice(-4000);
      });

      processo.on('error', falhar);

      processo.on('close', codigo => {
        if (finalizado) return;

        if (codigo !== 0 || !fs.existsSync(arquivo)) {
          return falhar(
            new Error(
              `FFmpeg falhou (${codigo}): ${stderr.slice(-600)}`
            )
          );
        }

        finalizado = true;

        resolve({
          pasta,
          arquivo
        });
      });
    } catch (error) {
      limpar();
      reject(error);
    }
  });
}

const server = http.createServer(async (req, res) => {
  const rota = new URL(
    req.url,
    'http://localhost'
  ).pathname;

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
      gerarVideo: 'disponível'
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
    } catch (error) {
      return sendJSON(res, 502, {
        status: 'erro',
        hotmart: 'erro',
        mensagem: error.message
      });
    }
  }

  if (rota === '/api/products') {
    try {
      const token = await getHotmartToken();

      const response = await fetch(
        'https://developers.hotmart.com/products/api/v1/products?max_results=50',
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json'
          }
        }
      );

      const data = await response.json();

      return sendJSON(
        res,
        response.status,
        data
      );
    } catch (error) {
      return sendJSON(res, 502, {
        status: 'erro',
        mensagem: error.message
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
    let resultado;

    try {
      resultado = await gerarVideo();

      const tamanho = fs.statSync(
        resultado.arquivo
      ).size;

      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Disposition':
          'attachment; filename="rendabot-video.mp4"',
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
    } catch (error) {
      if (resultado) {
        fs.rmSync(resultado.pasta, {
          recursive: true,
          force: true
        });
      }

      return sendJSON(res, 500, {
        status: 'erro',
        mensagem: 'Não foi possível gerar o vídeo',
        detalhes: error.message
      });
    }
  }

  return sendJSON(res, 404, {
    error: 'Rota não encontrada'
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `RendaBot online na porta ${PORT}`
  );
});
