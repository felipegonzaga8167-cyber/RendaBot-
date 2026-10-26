
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 10000;

const produto = {
  id: 4814942,
  nome: 'Onde está na Bíblia - Versículos bíblicos contra as heresias modernas',
  linkAfiliado: 'https://go.hotmart.com/F107572734G',
  assunto: 'Bíblia',
  ativo: true
};

const cenas = [
  'Você gosta de estudar a Bíblia?',
  'Conheça um material sobre versículos bíblicos',
  'Confira os detalhes no link da descrição'
];

const DURACAO = 7;

function json(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(obj));
}

async function fetchTimeout(url, opts = {}) {
  return fetch(url, {
    ...opts,
    signal: AbortSignal.timeout(18000)
  });
}

async function hotmartToken() {
  const id = process.env.HOTMART_CLIENT_ID;
  const secret = process.env.HOTMART_CLIENT_SECRET;
  const basic = process.env.HOTMART_BASIC;

  if (!id || !secret || !basic) {
    throw Error('Credenciais Hotmart ausentes');
  }

  const p = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: id,
    client_secret: secret
  });

  const r = await fetchTimeout(
    'https://api-sec-vlc.hotmart.com/security/oauth/token?' + p,
    {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + basic,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );

  if (!r.ok) {
    throw Error('Hotmart HTTP ' + r.status);
  }

  const d = await r.json();

  if (!d.access_token) {
    throw Error('Token não recebido');
  }

  return d.access_token;
}

async function pesquisar() {
  const resultado = {
    produto: produto.nome,
    assunto: produto.assunto,
    imagens: [],
    noticias: [],
    fontes: [],
    avisos: []
  };

  try {
    const api =
      'https://commons.wikimedia.org/w/api.php?' +
      new URLSearchParams({
        action: 'query',
        generator: 'search',
        gsrsearch: 'filetype:bitmap ' + produto.assunto,
        gsrnamespace: '6',
        gsrlimit: '15',
        prop: 'imageinfo',
        iiprop: 'url|extmetadata',
        iiurlwidth: '900',
        format: 'json',
        origin: '*'
      });

    const r = await fetchTimeout(api, {
      headers: {
        'User-Agent': 'RendaBot/4.0 (affiliate video creator)'
      }
    });

    if (!r.ok) {
      throw Error('Commons HTTP ' + r.status);
    }

    const d = await r.json();

    for (const page of Object.values(d.query?.pages || {})) {
      const info = page.imageinfo?.[0];
      const meta = info?.extmetadata || {};

      const license = (
        meta.LicenseShortName?.value || ''
      ).replace(/<[^>]*>/g, '');

      const url = info?.thumburl || info?.url;
      const type = info?.mime || '';

      if (
        !url ||
        (
          !/\.(jpg|jpeg|png)(\?|$)/i.test(url) &&
          !/image\/(jpeg|png)/.test(type)
        )
      ) {
        continue;
      }

      if (!/^(CC0|Public domain|Público domínio)/i.test(license)) {
        continue;
      }

      resultado.imagens.push({
        titulo: page.title,
        url,
        licenca: license,
        fonte: info.descriptionurl ||
          'https://commons.wikimedia.org/',
        autor: (meta.Artist?.value || '')
          .replace(/<[^>]*>/g, '')
          .slice(0, 140)
      });

      if (resultado.imagens.length >= 6) {
        break;
      }
    }

    if (!resultado.imagens.length) {
      resultado.avisos.push(
        'Nenhuma imagem com licença compatível foi confirmada.'
      );
    }

  } catch (e) {
    resultado.avisos.push(
      'Pesquisa de imagens indisponível: ' + e.message
    );
  }

  const noticiasURL =
    'https://www.google.com/search?' +
    new URLSearchParams({
      q: produto.assunto + ' notícias',
      tbm: 'nws'
    });

  resultado.fontes.push({
    tipo: 'Consulta de notícias',
    url: noticiasURL,
    observacao:
      'Link para pesquisa manual; notícias não verificadas automaticamente.'
  });

  resultado.avisos.push(
    'A análise automática de notícias ainda não está habilitada.'
  );

  resultado.fontes.push({
    tipo: 'Produto Hotmart',
    url: produto.linkAfiliado
  });

  return resultado;
}

const FONT = {
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

function textoNormal(t) {
  return t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ?!.,]/g, ' ');
}

function linhasTexto(t) {
  let linhas = [];
  let atual = '';

  for (const palavra of textoNormal(t).split(/\s+/)) {
    if (!palavra) continue;

    if ((atual + ' ' + palavra).trim().length > 22 && atual) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = (atual + ' ' + palavra).trim();
    }
  }

  if (atual) linhas.push(atual);

  return linhas;
}

function criarPPM(arquivo, cor, texto) {
  const W = 720;
  const H = 1280;

  const pixels = Buffer.alloc(W * H * 3);

  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = cor[0];
    pixels[i + 1] = cor[1];
    pixels[i + 2] = cor[2];
  }

  function rect(x, y, w, h, c) {
    for (
      let yy = Math.max(0, y | 0);
      yy < Math.min(H, (y + h) | 0);
      yy++
    ) {
      for (
        let xx = Math.max(0, x | 0);
        xx < Math.min(W, (x + w) | 0);
        xx++
      ) {
        const p = (yy * W + xx) * 3;

        pixels[p] = c[0];
        pixels[p + 1] = c[1];
        pixels[p + 2] = c[2];
      }
    }
  }

  const ls = linhasTexto(texto);
  const y0 = Math.round(H / 2 - ls.length * 32);

  rect(
    22,
    y0 - 40,
    676,
    ls.length * 65 + 65,
    [12, 20, 36]
  );

  ls.forEach((l, n) => {
    let x = Math.round((W - l.length * 36) / 2);
    let y = y0 + n * 65;

    for (const ch of l) {
      const shape = FONT[ch] || FONT[' '];

      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (shape[row][col] === '1') {
            rect(
              x + col * 6,
              y + row * 6,
              6,
              6,
              [255, 255, 255]
            );
          }
        }
      }

      x += 36;
    }
  });

  rect(80, 1080, 560, 8, [241, 184, 74]);

  fs.writeFileSync(
    arquivo,
    Buffer.concat([
      Buffer.from(`P6\n${W} ${H}\n255\n`),
      pixels
    ])
  );
}

function ff(args) {
  return new Promise((resolve, reject) => {
    const binary = require('ffmpeg-static');
    const p = spawn(binary, args);
    let log = '';

    p.stderr.on('data', b => {
      log = (log + b.toString()).slice(-3000);
    });

    p.on('error', reject);

    p.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          Error('FFmpeg: ' + log.slice(-900))
        );
      }
    });
  });
}

async function vozHTTP(dir) {
  const params = new URLSearchParams({
    ie: 'UTF-8',
    client: 'tw-ob',
    tl: 'pt-BR',
    q: cenas.join(' ')
  });

  const r = await fetchTimeout(
    'https://translate.google.com/translate_tts?' + params,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'audio/mpeg,*/*'
      }
    }
  );

  if (!r.ok) {
    throw Error(
      'Serviço de voz HTTP ' + r.status
    );
  }

  const b = Buffer.from(await r.arrayBuffer());

  if (
    b.length < 1000 ||
    !(
      b.toString('ascii', 0, 3) === 'ID3' ||
      (b[0] === 255 && (b[1] & 224) === 224)
    )
  ) {
    throw Error('Áudio MP3 inválido');
  }

  const file = path.join(dir, 'voz.mp3');

  fs.writeFileSync(file, b);

  return file;
}

async function baixarImagem(url, destino) {
  const r = await fetchTimeout(url);

  if (!r.ok) {
    throw Error('Imagem HTTP ' + r.status);
  }

  const ct = r.headers.get('content-type') || '';

  if (!ct.startsWith('image/')) {
    throw Error('Arquivo não é imagem');
  }

  const b = Buffer.from(await r.arrayBuffer());

  if (b.length < 3000 || b.length > 8000000) {
    throw Error('Imagem fora do limite');
  }

  fs.writeFileSync(destino, b);

  return destino;
}

async function gerarVideo(voz) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rendabot4-')
  );

  try {
    const pesquisa = await pesquisar();
    const audio = await vozHTTP(dir);
    const imagens = [];

    for (let i = 0; i < 3; i++) {
      let imagem = null;
      const item = pesquisa.imagens[i];

      if (item) {
        try {
          imagem = await baixarImagem(
            item.url,
            path.join(dir, `foto${i}.jpg`)
          );
        } catch (e) {
          console.log(
            'Imagem indisponível:',
            e.message
          );
        }
      }

      if (!imagem) {
        imagem = path.join(dir, `fundo${i}.ppm`);

        criarPPM(
          imagem,
          [
            [20, 33, 61],
            [29, 53, 87],
            [43, 70, 105]
          ][i],
          cenas[i]
        );
      }

      imagens.push(imagem);
    }

    const saida = path.join(dir, 'video.mp4');
    const inputs = [];

    for (const im of imagens) {
      inputs.push(
        '-loop', '1',
        '-framerate', '24',
        '-t', String(DURACAO),
        '-i', im
      );
    }

    inputs.push('-i', audio);

    const filtros = [];

    for (let i = 0; i < 3; i++) {
      filtros.push(
        `[${i}:v]` +
        'scale=720:1280:force_original_aspect_ratio=increase,' +
        'crop=720:1280,' +
        'eq=brightness=-0.08:saturation=0.9,' +
        'setsar=1,format=yuv420p,' +
        'trim=duration=7,setpts=PTS-STARTPTS' +
        `[v${i}]`
      );
    }

    filtros.push(
      '[v0][v1][v2]concat=n=3:v=1:a=0[outv]'
    );

    const af = voz === 'masculina'
      ? 'aresample=44100,asetrate=38000,aresample=44100,apad'
      : 'aresample=44100,asetrate=47000,aresample=44100,apad';

    await ff([
      '-y',
      ...inputs,
      '-filter_complex', filtros.join(';'),
      '-map', '[outv]',
      '-map', '3:a:0',
      '-af', af,
      '-t', '21',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      saida
    ]);

    return { dir, saida, pesquisa };

  } catch (e) {
    fs.rmSync(dir, {
      recursive: true,
      force: true
    });

    throw e;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const rota = url.pathname;

    if (req.method !== 'GET') {
      return json(res, 405, {
        erro: 'Método não permitido'
      });
    }

    if (rota === '/' || rota === '/api/health') {
      return json(res, 200, {
        status: 'online',
        app: 'RendaBot',
        versao: '4.0'
      });
    }

    if (rota === '/api/afiliados') {
      return json(res, 200, {
        total: 1,
        produtos: [produto]
      });
    }

    if (rota === '/api/conteudos') {
      return json(res, 200, {
        conteudos: [{
          produto: produto.nome,
          link: produto.linkAfiliado,
          cenas,
          legenda:
            `Conheça ${produto.nome}: ` +
            `${produto.linkAfiliado} ` +
            '#Publicidade #LinkDeAfiliado'
        }]
      });
    }

    if (rota === '/api/pesquisa') {
      return json(res, 200, await pesquisar());
    }

    if (rota === '/api/status') {
      try {
        await hotmartToken();

        return json(res, 200, {
          status: 'online',
          hotmart: 'conectada'
        });

      } catch (e) {
        return json(res, 502, {
          status: 'online',
          hotmart: 'erro',
          mensagem: e.message
        });
      }
    }

    if (rota === '/api/products') {
      try {
        const token = await hotmartToken();

        const r = await fetchTimeout(
          'https://developers.hotmart.com/products/api/v1/products?max_results=50',
          {
            headers: {
              Authorization: 'Bearer ' + token,
              Accept: 'application/json'
            }
          }
        );

        const t = await r.text();
        let d;

        try {
          d = JSON.parse(t);
        } catch {
          d = { mensagem: t.slice(0, 400) };
        }

        return json(res, r.status, d);

      } catch (e) {
        return json(res, 502, {
          erro: e.message
        });
      }
    }

    if (rota === '/api/video') {
      const voz =
        url.searchParams.get('voz') || 'feminina';

      if (!['feminina', 'masculina'].includes(voz)) {
        return json(res, 400, {
          erro: 'Voz inválida'
        });
      }

      try {
        const v = await gerarVideo(voz);
        const size = fs.statSync(v.saida).size;

        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': size,
          'Content-Disposition':
            `attachment; filename="rendabot-${voz}.mp4"`
        });

        const stream = fs.createReadStream(v.saida);

        stream.on('close', () => {
          fs.rmSync(v.dir, {
            recursive: true,
            force: true
          });
        });

        stream.on('error', e => {
          console.error(e);
          res.destroy();
        });

        stream.pipe(res);
        return;

      } catch (e) {
        console.error(e);

        return json(res, 500, {
          erro: 'Falha ao gerar vídeo',
          detalhes: e.message
        });
      }
    }

    return json(res, 404, {
      erro: 'Rota não encontrada'
    });

  } catch (e) {
    console.error(e);

    if (!res.headersSent) {
      json(res, 500, {
        erro: e.message
      });
    } else {
      res.destroy();
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('RendaBot 4.0 online:', PORT);
});
