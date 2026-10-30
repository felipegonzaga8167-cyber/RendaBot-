
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const sharp = require('sharp');
const ffmpeg = require('ffmpeg-static');

const PORT = Number(process.env.PORT) || 10000;
const API_KEY = process.env.RENDABOT_API_KEY || '';

const DEFAULT = {
  id: 4814942,
  nome: 'Onde está na Bíblia - Versículos bíblicos contra as heresias modernas',
  assunto: 'Bíblia',
  linkAfiliado: 'https://go.hotmart.com/F107572734G',
  ativo: true
};

let running = false;
let lastJob = null;

function reply(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function products() {
  const a = process.env.RENDABOT_PRODUCTS_JSON
    ? JSON.parse(process.env.RENDABOT_PRODUCTS_JSON)
    : [DEFAULT];

  if (!Array.isArray(a)) {
    throw Error('RENDABOT_PRODUCTS_JSON deve ser uma lista');
  }

  return a.filter(p =>
    p &&
    p.ativo !== false &&
    typeof p.nome === 'string' &&
    typeof p.linkAfiliado === 'string' &&
    /^https:\/\//.test(p.linkAfiliado)
  ).map(p => ({
    ...p,
    assunto: String(p.assunto || p.nome)
  }));
}

function choose(id) {
  return id
    ? products().find(p => String(p.id) === String(id))
    : products()[0];
}

function scenes(p) {
  return [
    `Você quer aprender mais sobre ${p.assunto}?`,
    `Conheça ${p.nome}.`,
    'Confira os detalhes no link da descrição.'
  ];
}

function caption(p) {
  return `Conheça ${p.nome}: ${p.linkAfiliado} #Publicidade #LinkDeAfiliado`;
}

async function request(url, options = {}) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20000)
  });
}

async function token() {
  const id = process.env.HOTMART_CLIENT_ID;
  const secret = process.env.HOTMART_CLIENT_SECRET;
  const basic = process.env.HOTMART_BASIC;

  if (!id || !secret || !basic) {
    throw Error('Credenciais Hotmart ausentes');
  }

  const r = await request(
    'https://api-sec-vlc.hotmart.com/security/oauth/token',
    {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + basic,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: id,
        client_secret: secret
      })
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

async function hotmartProducts() {
  const access = await token();

  const r = await request(
    'https://developers.hotmart.com/products/api/v1/products?max_results=50',
    {
      headers: {
        Authorization: 'Bearer ' + access,
        Accept: 'application/json'
      }
    }
  );

  const text = await r.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { mensagem: text.slice(0, 300) };
  }

  return { status: r.status, data };
}

function clean(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

async function research(p) {
  const result = {
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
    const q = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: 'filetype:bitmap ' + p.assunto,
      gsrnamespace: '6',
      gsrlimit: '30',
      prop: 'imageinfo',
      iiprop: 'url|mime|extmetadata',
      iiurlwidth: '900',
      format: 'json'
    });

    const r = await request(
      'https://commons.wikimedia.org/w/api.php?' + q,
      {
        headers: {
          'User-Agent': 'RendaBot/6.0 (video creator)'
        }
      }
    );

    if (!r.ok) {
      throw Error('Commons HTTP ' + r.status);
    }

    const d = await r.json();

    for (const page of Object.values(d.query?.pages || {})) {
      const i = page.imageinfo?.[0];

      if (!i) continue;

      const license = clean(
        i.extmetadata?.LicenseShortName?.value
      );

      if (!/^(CC0|Public domain|Domínio público|Público domínio)$/i.test(license)) {
        continue;
      }

      if (!/^image\/(jpeg|png)$/.test(i.mime || '')) {
        continue;
      }

      const url = i.thumburl || i.url;

      if (
        !url ||
        !url.startsWith('https://upload.wikimedia.org/')
      ) {
        continue;
      }

      result.imagens.push({
        titulo: page.title,
        url,
        licenca: license,
        fonte: i.descriptionurl ||
          'https://commons.wikimedia.org/',
        autor: clean(
          i.extmetadata?.Artist?.value
        )
      });

      if (result.imagens.length >= 6) break;
    }

  } catch (e) {
    result.avisos.push(
      'Pesquisa de imagens: ' + e.message
    );
  }

  result.avisos.push(
    'Notícias e demanda de mercado ainda não são verificadas automaticamente.'
  );

  return result;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let log = '';

    p.stderr.on('data', b => {
      log = (log + b.toString()).slice(-5000);
    });

    p.once('error', reject);

    p.once('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          Error('FFmpeg: ' + log.slice(-1200))
        );
      }
    });
  });
}

function escapeXML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrap(text, max = 23) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';

  for (const w of words) {
    if (
      (line + ' ' + w).trim().length > max &&
      line
    ) {
      lines.push(line);
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }

  if (line) lines.push(line);

  return lines.slice(0, 8);
}

async function download(url) {
  const r = await request(url);

  if (!r.ok) {
    throw Error('Imagem HTTP ' + r.status);
  }

  const len = Number(
    r.headers.get('content-length') || 0
  );

  if (len > 8000000) {
    throw Error('Imagem muito grande');
  }

  const mime =
    r.headers.get('content-type') || '';

  if (!/^image\/(jpeg|png)/.test(mime)) {
    throw Error('Formato de imagem inválido');
  }

  const b = Buffer.from(await r.arrayBuffer());

  if (b.length < 1000 || b.length > 8000000) {
    throw Error('Tamanho de imagem inválido');
  }

  return b;
}

async function makeFrame(text, image, file, index) {
  const colors = [
    '#14213d',
    '#1d3557',
    '#2b4669'
  ];

  let base;

  if (image) {
    try {
      base = sharp(image).resize(720, 1280, {
        fit: 'cover'
      });
    } catch {
      base = null;
    }
  }

  if (!base) {
    base = sharp({
      create: {
        width: 720,
        height: 1280,
        channels: 3,
        background: colors[index % colors.length]
      }
    });
  }

  const lines = wrap(text);
  const fontSize = lines.length > 5 ? 30 : 36;
  const lineHeight = fontSize + 14;

  const start =
    640 - ((lines.length - 1) * lineHeight) / 2;

  const spans = lines.map((line, i) =>
    `<text x="360" y="${Math.round(start + i * lineHeight)}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="${fontSize}" font-weight="bold" fill="white">${escapeXML(line)}</text>`
  ).join('');

  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280">
      <rect x="20" y="390" width="680" height="490" rx="24" fill="#07101f" fill-opacity="0.78"/>
      ${spans}
      <rect x="90" y="1090" width="540" height="7" rx="3" fill="#e9b85b"/>
    </svg>`
  );

  await base
    .composite([{ input: svg }])
    .png()
    .toFile(file);
}

async function synthesize(dir, lines, voice) {
  const { EdgeTTS } = require('node-edge-tts');

  const tts = new EdgeTTS({
    voice: voice === 'masculina'
      ? 'pt-BR-AntonioNeural'
      : 'pt-BR-FranciscaNeural',
    lang: 'pt-BR',
    outputFormat:
      'audio-24khz-48kbitrate-mono-mp3'
  });

  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const f = path.join(
      dir,
      `audio${i}.mp3`
    );

    await tts.ttsPromise(lines[i], f);

    if (
      !fs.existsSync(f) ||
      fs.statSync(f).size < 500
    ) {
      throw Error('Áudio não gerado');
    }

    result.push(f);
  }

  return result;
}

async function generate(p, voice) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rendabot6-')
  );

  try {
    const lines = scenes(p);
    const researchResult = await research(p);
    const audios = await synthesize(dir, lines, voice);
    const clips = [];

    for (let i = 0; i < lines.length; i++) {
      let image = null;
      const candidate = researchResult.imagens[i];

      if (candidate) {
        try {
          image = await download(candidate.url);
        } catch (e) {
          console.warn(
            'Imagem ignorada:',
            e.message
          );
        }
      }

      const frame = path.join(
        dir,
        `frame${i}.png`
      );

      await makeFrame(
        lines[i],
        image,
        frame,
        i
      );

      const clip = path.join(
        dir,
        `scene${i}.mp4`
      );

      await run(ffmpeg, [
        '-y',
        '-loop', '1',
        '-framerate', '24',
        '-i', frame,
        '-i', audios[i],
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        '-r', '24',
        '-c:a', 'aac',
        '-ar', '44100',
        '-b:a', '128k',
        '-shortest',
        clip
      ]);

      clips.push(clip);
    }

    const list = path.join(dir, 'clips.txt');

    fs.writeFileSync(
      list,
      clips.map(c => `file '${c}'`).join('\n')
    );

    const output = path.join(
      dir,
      'video.mp4'
    );

    await run(ffmpeg, [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', list,
      '-c', 'copy',
      '-movflags', '+faststart',
      output
    ]);

    return {
      dir,
      output,
      researchResult
    };

  } catch (e) {
    fs.rmSync(dir, {
      recursive: true,
      force: true
    });

    throw e;
  }
}

function authorized(req, url) {
  if (!API_KEY) return false;

  const value =
    req.headers.authorization?.replace(/^Bearer /, '') ||
    url.searchParams.get('key') ||
    '';

  const a = Buffer.from(value);
  const b = Buffer.from(API_KEY);

  return a.length === b.length &&
    crypto.timingSafeEqual(a, b);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url,
      'http://localhost'
    );

    const route = url.pathname;

    if (req.method !== 'GET') {
      return reply(res, 405, {
        erro: 'Método não permitido'
      });
    }

    if (
      route === '/' ||
      route === '/api/health'
    ) {
      return reply(res, 200, {
        status: 'online',
        app: 'RendaBot',
        versao: '6.0.1',
        processando: running
      });
    }

    if (!authorized(req, url)) {
      return reply(res, 401, {
        erro:
          'Chave inválida ou ausente. Use Authorization: Bearer <chave>.'
      });
    }

    if (route === '/api/afiliados') {
      return reply(res, 200, {
        total: products().length,
        produtos: products()
      });
    }

    if (route === '/api/oportunidades') {
      return reply(res, 200, {
        origem:
          'Produtos configurados, sem pesquisa automática de mercado',
        produtos: products().map(p => ({
          ...p,
          pontuacao: null,
          avaliacao:
            'Dados insuficientes para avaliar oportunidade real'
        }))
      });
    }

    if (route === '/api/conteudos') {
      return reply(res, 200, {
        conteudos: products().map(p => ({
          produto: p.nome,
          link: p.linkAfiliado,
          cenas: scenes(p),
          legenda: caption(p)
        }))
      });
    }

    if (route === '/api/pesquisa') {
      const p = choose(
        url.searchParams.get('id')
      );

      return p
        ? reply(res, 200, await research(p))
        : reply(res, 404, {
            erro: 'Produto não encontrado'
          });
    }

    if (route === '/api/status') {
      try {
        await token();

        return reply(res, 200, {
          status: 'online',
          hotmart: 'token obtido'
        });

      } catch (e) {
        return reply(res, 502, {
          hotmart: 'erro',
          mensagem: e.message
        });
      }
    }

    if (route === '/api/products') {
      try {
        const x = await hotmartProducts();

        return reply(res, x.status, x.data);

      } catch (e) {
        return reply(res, 502, {
          erro: e.message
        });
      }
    }

    if (route === '/api/automacao') {
      return reply(res, 200, {
        afiliacaoAutomatica: false,
        publicacaoAutomatica: false,
        agendamento: false,
        observacao:
          'Integrações ainda não implementadas'
      });
    }

    if (route === '/api/jobs') {
      return reply(res, 200, {
        processando: running,
        ultimo: lastJob
      });
    }

    if (route === '/api/video') {
      if (running) {
        return reply(res, 429, {
          erro: 'Vídeo já em processamento'
        });
      }

      const p = choose(
        url.searchParams.get('id')
      );

      if (!p) {
        return reply(res, 404, {
          erro: 'Produto não encontrado'
        });
      }

      const voice =
        url.searchParams.get('voz') ||
        'feminina';

      if (
        !['feminina', 'masculina'].includes(voice)
      ) {
        return reply(res, 400, {
          erro: 'Voz inválida'
        });
      }

      running = true;

      lastJob = {
        produto: p.nome,
        inicio: new Date().toISOString(),
        status: 'processando'
      };

      try {
        const job = await generate(p, voice);
        const size = fs.statSync(job.output).size;

        lastJob = {
          ...lastJob,
          status: 'concluido',
          fim: new Date().toISOString(),
          bytes: size
        };

        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': size,
          'Content-Disposition':
            `attachment; filename="rendabot-${voice}.mp4"`
        });

        const stream =
          fs.createReadStream(job.output);

        let cleaned = false;

        const cleanup = () => {
          if (cleaned) return;

          cleaned = true;

          fs.rmSync(job.dir, {
            recursive: true,
            force: true
          });

          running = false;
        };

        res.once('close', cleanup);

        stream.once('error', e => {
          console.error(e);
          res.destroy();
          cleanup();
        });

        stream.pipe(res);
        return;

      } catch (e) {
        running = false;

        lastJob = {
          ...lastJob,
          status: 'erro',
          fim: new Date().toISOString(),
          erro: e.message
        };

        console.error(e);

        return reply(res, 500, {
          erro: 'Falha ao gerar vídeo',
          detalhes: e.message
        });
      }
    }

    return reply(res, 404, {
      erro: 'Rota não encontrada'
    });

  } catch (e) {
    console.error(e);

    if (!res.headersSent) {
      reply(res, 500, {
        erro: e.message
      });
    } else {
      res.destroy();
    }
  }
});

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      'RendaBot 6.0.1 online na porta',
      PORT
    );
  }
);
