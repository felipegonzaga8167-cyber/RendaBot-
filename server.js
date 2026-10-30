
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ffmpeg = require('ffmpeg-static');

const PORT = Number(process.env.PORT) || 10000;

const DEFAULT_PRODUCT = {
  id: 4814942,
  nome: 'Onde está na Bíblia - Versículos bíblicos contra as heresias modernas',
  linkAfiliado: 'https://go.hotmart.com/F107572734G',
  assunto: 'Bíblia',
  ativo: true
};

let busy = false;

function products() {
  if (!process.env.RENDABOT_PRODUCTS_JSON) {
    return [DEFAULT_PRODUCT];
  }

  const data = JSON.parse(
    process.env.RENDABOT_PRODUCTS_JSON
  );

  if (!Array.isArray(data)) {
    throw Error('RENDABOT_PRODUCTS_JSON deve ser uma lista');
  }

  return data.filter(p =>
    p &&
    p.ativo !== false &&
    typeof p.nome === 'string' &&
    typeof p.linkAfiliado === 'string' &&
    /^https:\/\//.test(p.linkAfiliado)
  );
}

function chooseProduct(id) {
  const all = products();

  return (
    id
      ? all.find(p => String(p.id) === String(id))
      : all[0]
  ) || null;
}

function scenes(p) {
  return [
    `Você quer aprender mais sobre ${p.assunto || p.nome}?`,
    `Conheça ${p.nome}.`,
    'Confira os detalhes no link da descrição.'
  ];
}

function send(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(data));
}

async function get(url, options = {}) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20000)
  });
}

async function hotmartToken() {
  const id = process.env.HOTMART_CLIENT_ID;
  const secret = process.env.HOTMART_CLIENT_SECRET;
  const basic = process.env.HOTMART_BASIC;

  if (!id || !secret || !basic) {
    throw Error('Credenciais Hotmart ausentes');
  }

  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: id,
    client_secret: secret
  });

  const r = await get(
    'https://api-sec-vlc.hotmart.com/security/oauth/token',
    {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + basic,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form
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

function plain(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

async function research(p) {
  const out = {
    produto: p.nome,
    imagens: [],
    noticias: [],
    fontes: [
      {
        tipo: 'Produto',
        url: p.linkAfiliado
      }
    ],
    avisos: []
  };

  try {
    const query = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: `filetype:bitmap ${p.assunto || p.nome}`,
      gsrnamespace: '6',
      gsrlimit: '30',
      prop: 'imageinfo',
      iiprop: 'url|mime|extmetadata',
      iiurlwidth: '900',
      format: 'json'
    });

    const r = await get(
      'https://commons.wikimedia.org/w/api.php?' + query,
      {
        headers: {
          'User-Agent': 'RendaBot/6.0'
        }
      }
    );

    if (!r.ok) {
      throw Error('Commons HTTP ' + r.status);
    }

    const data = await r.json();

    for (const page of Object.values(
      data.query?.pages || {}
    )) {
      const info = page.imageinfo?.[0];

      if (!info) continue;

      const license = plain(
        info.extmetadata?.LicenseShortName?.value
      );

      if (!/^(CC0|Public domain|Público domínio|Domínio público)/i.test(license)) {
        continue;
      }

      const url = info.thumburl || info.url;

      if (
        !url ||
        !/^https:\/\//.test(url) ||
        !/image\/(jpeg|png)/.test(info.mime || '')
      ) {
        continue;
      }

      out.imagens.push({
        titulo: page.title,
        url,
        licenca: license,
        fonte: info.descriptionurl ||
          'https://commons.wikimedia.org/',
        autor: plain(
          info.extmetadata?.Artist?.value
        ).slice(0, 120)
      });

      if (out.imagens.length === 6) break;
    }

    if (!out.imagens.length) {
      out.avisos.push(
        'Nenhuma imagem CC0 ou domínio público confirmada.'
      );
    }

  } catch (e) {
    out.avisos.push(
      'Pesquisa de imagens: ' + e.message
    );
  }

  out.fontes.push({
    tipo: 'Pesquisa manual de notícias',
    url: 'https://www.google.com/search?' +
      new URLSearchParams({
        q: (p.assunto || p.nome) + ' notícias',
        tbm: 'nws'
      })
  });

  out.avisos.push(
    'Notícias não são verificadas automaticamente.'
  );

  return out;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stderr = '';

    child.stderr.on('data', b => {
      stderr = (stderr + b).slice(-5000);
    });

    child.on('error', reject);

    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          Error('Processo falhou: ' + stderr.slice(-1200))
        );
      }
    });
  });
}

function escDraw(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 .,!?-]/g, ' ')
    .replace(/\\/g, '')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%');
}

function wrap(s, max = 25) {
  const words = escDraw(s).split(/\s+/);
  const lines = [];
  let line = '';

  for (const word of words) {
    if (
      (line + ' ' + word).trim().length > max &&
      line
    ) {
      lines.push(line);
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }

  if (line) lines.push(line);

  return lines.slice(0, 5);
}

async function downloadImage(url, file) {
  const r = await get(url);

  if (!r.ok) {
    throw Error('Imagem HTTP ' + r.status);
  }

  const mime = r.headers.get('content-type') || '';

  if (!/^image\/(jpeg|png)/i.test(mime)) {
    throw Error('Formato não suportado');
  }

  const b = Buffer.from(await r.arrayBuffer());

  if (b.length < 1000 || b.length > 8000000) {
    throw Error('Tamanho inválido');
  }

  fs.writeFileSync(file, b);
}

async function voice(dir, lines, voiceChoice) {
  const { EdgeTTS } = require('node-edge-tts');

  const tts = new EdgeTTS({
    voice: voiceChoice === 'masculina'
      ? 'pt-BR-AntonioNeural'
      : 'pt-BR-FranciscaNeural',
    lang: 'pt-BR',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
  });

  const outputs = [];

  for (let i = 0; i < lines.length; i++) {
    const file = path.join(dir, `voz${i}.mp3`);

    await tts.ttsPromise(lines[i], file);

    if (
      !fs.existsSync(file) ||
      fs.statSync(file).size < 500
    ) {
      throw Error('Narração não gerada');
    }

    outputs.push(file);
  }

  return outputs;
}

async function generate(p, voiceChoice) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rendabot6-')
  );

  try {
    const lines = scenes(p);
    const info = await research(p);
    const audio = await voice(dir, lines, voiceChoice);
    const clips = [];

    const font = process.env.RENDABOT_FONT ||
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

    for (let i = 0; i < lines.length; i++) {
      let image = null;

      if (info.imagens[i]) {
        try {
          image = path.join(dir, `imagem${i}.jpg`);

          await downloadImage(
            info.imagens[i].url,
            image
          );
        } catch (e) {
          image = null;
          console.warn('Imagem:', e.message);
        }
      }

      const clip = path.join(dir, `cena${i}.mp4`);

      const base = image
        ? [
            '-loop', '1',
            '-framerate', '24',
            '-i', image
          ]
        : [
            '-f', 'lavfi',
            '-i',
            `color=c=${[
              '0x14213d',
              '0x1d3557',
              '0x2b4669'
            ][i]}:s=720x1280:r=24`
          ];

      const text = wrap(lines[i]).join('\\n');

      const overlay = fs.existsSync(font)
        ? `,drawbox=x=20:y=430:w=680:h=360:color=black@0.65:t=fill,drawtext=fontfile=${font}:text='${text}':fontcolor=white:fontsize=38:line_spacing=15:x=(w-text_w)/2:y=(h-text_h)/2`
        : '';

      await run(ffmpeg, [
        '-y',
        ...base,
        '-i', audio[i],
        '-vf',
        `scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,format=yuv420p${overlay}`,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-r', '24',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-shortest',
        '-movflags', '+faststart',
        clip
      ]);

      clips.push(clip);
    }

    const list = path.join(dir, 'clips.txt');

    fs.writeFileSync(
      list,
      clips.map(c => `file '${c}'`).join('\n')
    );

    const output = path.join(dir, 'video.mp4');

    await run(ffmpeg, [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', list,
      '-c', 'copy',
      '-movflags', '+faststart',
      output
    ]);

    return { dir, output, info };

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
    const u = new URL(req.url, 'http://localhost');
    const route = u.pathname;

    if (req.method !== 'GET') {
      return send(res, 405, {
        erro: 'Método não permitido'
      });
    }

    if (
      route === '/' ||
      route === '/api/health'
    ) {
      return send(res, 200, {
        status: 'online',
        app: 'RendaBot',
        versao: '6.0'
      });
    }

    if (route === '/api/afiliados') {
      const all = products();

      return send(res, 200, {
        total: all.length,
        produtos: all
      });
    }

    if (route === '/api/conteudos') {
      return send(res, 200, {
        conteudos: products().map(p => ({
          produto: p.nome,
          link: p.linkAfiliado,
          cenas: scenes(p),
          legenda:
            `Conheça ${p.nome}: ${p.linkAfiliado} ` +
            '#Publicidade #LinkDeAfiliado'
        }))
      });
    }

    if (route === '/api/pesquisa') {
      const p = chooseProduct(
        u.searchParams.get('id')
      );

      return p
        ? send(res, 200, await research(p))
        : send(res, 404, {
            erro: 'Produto não encontrado'
          });
    }

    if (route === '/api/status') {
      try {
        await hotmartToken();

        return send(res, 200, {
          status: 'online',
          hotmart: 'conectada'
        });

      } catch (e) {
        return send(res, 502, {
          status: 'online',
          hotmart: 'erro',
          mensagem: e.message
        });
      }
    }

    if (route === '/api/products') {
      try {
        const token = await hotmartToken();

        const r = await get(
          'https://developers.hotmart.com/products/api/v1/products?max_results=50',
          {
            headers: {
              Authorization: 'Bearer ' + token,
              Accept: 'application/json'
            }
          }
        );

        const body = await r.text();
        let d;

        try {
          d = JSON.parse(body);
        } catch {
          d = { mensagem: body.slice(0, 400) };
        }

        return send(res, r.status, d);

      } catch (e) {
        return send(res, 502, {
          erro: e.message
        });
      }
    }

    if (route === '/api/video') {
      if (busy) {
        return send(res, 429, {
          erro: 'Já existe um vídeo em processamento'
        });
      }

      const p = chooseProduct(
        u.searchParams.get('id')
      );

      if (!p) {
        return send(res, 404, {
          erro: 'Produto não encontrado'
        });
      }

      const voiceChoice =
        u.searchParams.get('voz') || 'feminina';

      if (
        !['feminina', 'masculina'].includes(voiceChoice)
      ) {
        return send(res, 400, {
          erro: 'Voz inválida'
        });
      }

      busy = true;
      let job;

      try {
        job = await generate(p, voiceChoice);

        const size = fs.statSync(job.output).size;

        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': size,
          'Content-Disposition':
            `attachment; filename="rendabot-${voiceChoice}.mp4"`
        });

        const stream = fs.createReadStream(job.output);

        const cleanup = () => {
          fs.rmSync(job.dir, {
            recursive: true,
            force: true
          });

          busy = false;
        };

        res.on('close', cleanup);

        stream.on('error', e => {
          console.error(e);
          res.destroy();
        });

        stream.pipe(res);
        return;

      } catch (e) {
        busy = false;
        console.error(e);

        return send(res, 500, {
          erro: 'Falha ao gerar vídeo',
          detalhes: e.message
        });
      }
    }

    return send(res, 404, {
      erro: 'Rota não encontrada'
    });

  } catch (e) {
    console.error(e);

    if (!res.headersSent) {
      send(res, 500, {
        erro: e.message
      });
    } else {
      res.destroy();
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('RendaBot 6.0 online:', PORT);
});
