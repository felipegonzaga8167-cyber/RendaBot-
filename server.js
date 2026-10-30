
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ffmpeg = require('ffmpeg-static');

const PORT = Number(process.env.PORT || 10000);
const API_KEY = process.env.RENDABOT_API_KEY || '';

const DEFAULT = {
  id: 4814942,
  nome: 'Onde está na Bíblia - Versículos bíblicos contra as heresias modernas',
  assunto: 'Bíblia',
  linkAfiliado: 'https://go.hotmart.com/F107572734G',
  ativo: true,
  comissao: 0
};

let running = false;
let lastJob = null;

function respond(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function safeError(e) {
  return e instanceof Error ? e.message : String(e);
}

function products() {
  let p = process.env.RENDABOT_PRODUCTS_JSON
    ? JSON.parse(process.env.RENDABOT_PRODUCTS_JSON)
    : [DEFAULT];

  if (!Array.isArray(p)) {
    throw Error('RENDABOT_PRODUCTS_JSON deve ser um array');
  }

  return p.filter(x =>
    x &&
    x.ativo !== false &&
    typeof x.nome === 'string' &&
    x.nome.trim() &&
    typeof x.linkAfiliado === 'string' &&
    /^https:\/\//.test(x.linkAfiliado)
  ).map(x => ({
    ...x,
    assunto: String(x.assunto || x.nome)
  }));
}

function selectProduct(id) {
  const p = products();

  return id
    ? p.find(x => String(x.id) === String(id))
    : p[0];
}

function rank(p) {
  const commission = Number(p.comissao || 0);
  const demand = Number(p.demanda || 0);
  const competition = Number(p.concorrencia || 0);

  const score = Math.round(
    Math.max(0, Math.min(
      100,
      commission * 0.3 +
      demand * 0.5 +
      (100 - competition) * 0.2
    ))
  );

  return {
    ...p,
    pontuacao: score,
    avaliacao:
      'Estimativa com dados configurados; sem pesquisa de mercado em tempo real'
  };
}

function script(p) {
  return [
    `Você quer aprender mais sobre ${p.assunto}?`,
    `Conheça ${p.nome}.`,
    'Confira os detalhes no link da descrição.'
  ];
}

async function fetchSafe(url, options = {}) {
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

  const r = await fetchSafe(
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

  const r = await fetchSafe(
    'https://developers.hotmart.com/products/api/v1/products?max_results=50',
    {
      headers: {
        Authorization: 'Bearer ' + access,
        Accept: 'application/json'
      }
    }
  );

  const body = await r.text();
  let data;

  try {
    data = JSON.parse(body);
  } catch {
    data = {
      mensagem: body.slice(0, 300)
    };
  }

  return {
    status: r.status,
    data
  };
}

function strip(s) {
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
        tipo: 'Link afiliado configurado',
        url: p.linkAfiliado
      }
    ],
    avisos: []
  };

  try {
    const qs = new URLSearchParams({
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

    const r = await fetchSafe(
      'https://commons.wikimedia.org/w/api.php?' + qs,
      {
        headers: {
          'User-Agent':
            'RendaBot/6.0 (educational affiliate video bot)'
        }
      }
    );

    if (!r.ok) {
      throw Error('Commons HTTP ' + r.status);
    }

    const d = await r.json();

    for (const page of Object.values(
      d.query?.pages || {}
    )) {
      const i = page.imageinfo?.[0];

      if (!i) continue;

      const lic = strip(
        i.extmetadata?.LicenseShortName?.value
      );

      if (!/^(CC0|Public domain|Domínio público|Público domínio)$/i.test(lic)) {
        continue;
      }

      if (!/^image\/(jpeg|png)$/.test(i.mime || '')) {
        continue;
      }

      const url = i.thumburl || i.url;

      if (!url || !url.startsWith('https://')) {
        continue;
      }

      result.imagens.push({
        titulo: page.title,
        url,
        licenca: lic,
        fonte: i.descriptionurl ||
          'https://commons.wikimedia.org/',
        autor: strip(
          i.extmetadata?.Artist?.value
        )
      });

      if (result.imagens.length === 6) break;
    }

  } catch (e) {
    result.avisos.push(
      'Imagens: ' + safeError(e)
    );
  }

  result.fontes.push({
    tipo: 'Pesquisa manual de notícias',
    url: 'https://www.google.com/search?' +
      new URLSearchParams({
        q: p.assunto + ' notícias',
        tbm: 'nws'
      })
  });

  result.avisos.push(
    'Notícias não verificadas automaticamente. Confira direitos e relevância das imagens antes de publicar.'
  );

  return result;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args);
    let err = '';

    c.stderr.on('data', b => {
      err = (err + b).slice(-4000);
    });

    c.on('error', reject);

    c.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          Error(
            'FFmpeg ' + code + ': ' +
            err.slice(-1200)
          )
        );
      }
    });
  });
}

async function downloadImage(url, file) {
  const r = await fetchSafe(url);

  if (!r.ok) {
    throw Error('Imagem HTTP ' + r.status);
  }

  const mime =
    r.headers.get('content-type') || '';

  if (!/^image\/(jpeg|png)/.test(mime)) {
    throw Error('Formato de imagem inválido');
  }

  const len = Number(
    r.headers.get('content-length') || 0
  );

  if (len > 8000000) {
    throw Error('Imagem grande demais');
  }

  const b = Buffer.from(
    await r.arrayBuffer()
  );

  if (b.length < 1000 || b.length > 8000000) {
    throw Error('Tamanho inválido');
  }

  fs.writeFileSync(file, b);
}

function drawEscape(t) {
  return String(t)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 .,!?-]/g, ' ')
    .replace(/\\/g, '')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%');
}

function wrapText(t, max = 26) {
  const words = drawEscape(t).split(/\s+/);
  let lines = [];
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

  return lines.slice(0, 6).join('\\n');
}

async function synthesize(dir, lines, choice) {
  const { EdgeTTS } = require('node-edge-tts');

  const tts = new EdgeTTS({
    voice: choice === 'masculina'
      ? 'pt-BR-AntonioNeural'
      : 'pt-BR-FranciscaNeural',
    lang: 'pt-BR',
    outputFormat:
      'audio-24khz-48kbitrate-mono-mp3'
  });

  const files = [];

  for (let i = 0; i < lines.length; i++) {
    const f = path.join(
      dir,
      'voz' + i + '.mp3'
    );

    await tts.ttsPromise(lines[i], f);

    if (
      !fs.existsSync(f) ||
      fs.statSync(f).size < 500
    ) {
      throw Error('Narração vazia');
    }

    files.push(f);
  }

  return files;
}

async function makeVideo(p, choice) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rendabot6-')
  );

  try {
    const lines = script(p);
    const found = await research(p);
    const audios = await synthesize(
      dir,
      lines,
      choice
    );

    const clips = [];

    const font =
      process.env.RENDABOT_FONT ||
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

    if (!fs.existsSync(font)) {
      throw Error(
        'Fonte ausente: configure RENDABOT_FONT ou instale DejaVuSans'
      );
    }

    for (let i = 0; i < lines.length; i++) {
      let img = null;
      const item = found.imagens[i];

      if (item) {
        try {
          img = path.join(
            dir,
            'image' + i + '.jpg'
          );

          await downloadImage(item.url, img);

        } catch (e) {
          console.warn(
            'Imagem ignorada:',
            safeError(e)
          );

          img = null;
        }
      }

      const inputs = img
        ? [
            '-loop', '1',
            '-framerate', '24',
            '-i', img
          ]
        : [
            '-f', 'lavfi',
            '-i',
            `color=c=${
              [
                '0x14213d',
                '0x1d3557',
                '0x2b4669'
              ][i]
            }:s=720x1280:r=24`
          ];

      const textfile = path.join(
        dir,
        'texto' + i + '.txt'
      );

      fs.writeFileSync(
        textfile,
        wrapText(lines[i]).replace(/\\n/g, '\n')
      );

      const filter =
        'scale=720:1280:' +
        'force_original_aspect_ratio=increase,' +
        'crop=720:1280,' +
        'setsar=1,' +
        'format=yuv420p,' +
        'drawbox=x=18:y=400:w=684:h=460:' +
        'color=black@0.65:t=fill,' +
        `drawtext=fontfile=${font}:` +
        `textfile=${textfile}:` +
        'fontcolor=white:' +
        'fontsize=36:' +
        'line_spacing=12:' +
        'x=(w-text_w)/2:' +
        'y=(h-text_h)/2';

      const clip = path.join(
        dir,
        'scene' + i + '.mp4'
      );

      await run(ffmpeg, [
        '-y',
        ...inputs,
        '-i', audios[i],
        '-vf', filter,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-r', '24',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-ar', '44100',
        '-b:a', '128k',
        '-shortest',
        clip
      ]);

      clips.push(clip);
    }

    const concat = path.join(
      dir,
      'list.txt'
    );

    fs.writeFileSync(
      concat,
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
      '-i', concat,
      '-c', 'copy',
      '-movflags', '+faststart',
      output
    ]);

    return {
      dir,
      output,
      found
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

  const header =
    req.headers.authorization || '';

  return (
    header === 'Bearer ' + API_KEY ||
    url.searchParams.get('key') === API_KEY
  );
}

const server = http.createServer(
  async (req, res) => {
    try {
      const url = new URL(
        req.url,
        'http://localhost'
      );

      const route = url.pathname;

      if (req.method !== 'GET') {
        return respond(res, 405, {
          erro: 'Método não permitido'
        });
      }

      if (
        route === '/' ||
        route === '/api/health'
      ) {
        return respond(res, 200, {
          status: 'online',
          app: 'RendaBot',
          versao: '6.0',
          processando: running
        });
      }

      if (!authorized(req, url)) {
        return respond(res, 401, {
          erro:
            'Configure RENDABOT_API_KEY no Render e envie Authorization: Bearer <chave>. Para testes no navegador, use ?key=<chave>; não compartilhe essa URL.'
        });
      }

      if (route === '/api/afiliados') {
        return respond(res, 200, {
          total: products().length,
          produtos: products()
        });
      }

      if (route === '/api/oportunidades') {
        return respond(res, 200, {
          origem:
            'Produtos configurados; não é catálogo público',
          produtos: products()
            .map(rank)
            .sort(
              (a, b) =>
                b.pontuacao - a.pontuacao
            )
        });
      }

      if (route === '/api/conteudos') {
        return respond(res, 200, {
          conteudos: products().map(p => ({
            produto: p.nome,
            link: p.linkAfiliado,
            cenas: script(p),
            legenda:
              `Conheça ${p.nome}: ` +
              `${p.linkAfiliado} ` +
              '#Publicidade #LinkDeAfiliado'
          }))
        });
      }

      if (route === '/api/pesquisa') {
        const p = selectProduct(
          url.searchParams.get('id')
        );

        return p
          ? respond(
              res,
              200,
              await research(p)
            )
          : respond(res, 404, {
              erro: 'Produto não encontrado'
            });
      }

      if (route === '/api/status') {
        try {
          await token();

          return respond(res, 200, {
            status: 'online',
            hotmart: 'token obtido'
          });

        } catch (e) {
          return respond(res, 502, {
            status: 'online',
            hotmart: 'erro',
            mensagem: safeError(e)
          });
        }
      }

      if (route === '/api/products') {
        try {
          const result =
            await hotmartProducts();

          return respond(
            res,
            result.status,
            result.data
          );

        } catch (e) {
          return respond(res, 502, {
            erro: safeError(e)
          });
        }
      }

      if (route === '/api/automacao') {
        return respond(res, 200, {
          selecao:
            'Somente produtos configurados',
          afiliacaoAutomatica: false,
          publicacaoAutomatica: false,
          agendamento: false,
          observacao:
            'Sem permissões de plataformas, nenhuma afiliação ou publicação é executada'
        });
      }

      if (route === '/api/jobs') {
        return respond(res, 200, {
          processando: running,
          ultimo: lastJob
        });
      }

      if (route === '/api/video') {
        if (running) {
          return respond(res, 429, {
            erro:
              'Vídeo já em processamento'
          });
        }

        const p = selectProduct(
          url.searchParams.get('id')
        );

        if (!p) {
          return respond(res, 404, {
            erro: 'Produto não encontrado'
          });
        }

        const voice =
          url.searchParams.get('voz') ||
          'feminina';

        if (
          !['feminina', 'masculina']
            .includes(voice)
        ) {
          return respond(res, 400, {
            erro: 'Voz inválida'
          });
        }

        running = true;

        lastJob = {
          produto: p.nome,
          inicio: new Date().toISOString(),
          status: 'processando'
        };

        let job;

        try {
          job = await makeVideo(
            p,
            voice
          );

          const size =
            fs.statSync(job.output).size;

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

          function cleanup() {
            if (cleaned) return;

            cleaned = true;

            fs.rmSync(job.dir, {
              recursive: true,
              force: true
            });

            running = false;
          }

          res.on('close', cleanup);

          stream.on('error', e => {
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
            erro: safeError(e)
          };

          return respond(res, 500, {
            erro: 'Falha ao gerar vídeo',
            detalhes: safeError(e)
          });
        }
      }

      return respond(res, 404, {
        erro: 'Rota não encontrada'
      });

    } catch (e) {
      console.error(e);

      if (!res.headersSent) {
        respond(res, 500, {
          erro: safeError(e)
        });
      } else {
        res.destroy();
      }
    }
  }
);

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      'RendaBot 6.0 online na porta',
      PORT
    );
  }
);
