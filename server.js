
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const ffmpeg = require("ffmpeg-static");

const PORT = process.env.PORT || 10000;

const produtos = [
  {
    id: 4814942,
    nome: "Onde está na Bíblia - Versículos bíblicos contra as heresias modernas",
    plataforma: "Hotmart",
    linkAfiliado: "https://go.hotmart.com/F107572734G",
    ativo: true
  }
];

async function getHotmartToken() {
  const clientId = process.env.HOTMART_CLIENT_ID;
  const clientSecret = process.env.HOTMART_CLIENT_SECRET;
  const basic = process.env.HOTMART_BASIC;

  if (!clientId || !clientSecret || !basic) {
    throw new Error("Credenciais Hotmart não configuradas");
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  });

  const response = await fetch(
    "https://api-sec-vlc.hotmart.com/security/oauth/token?" +
      params.toString(),
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(
      `Falha na autenticação Hotmart: ${response.status}`
    );
  }

  return data.access_token;
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(data));
}

function gerarConteudos(produto) {
  return {
    produto: produto.nome,
    link: produto.linkAfiliado,
    aviso: "Publicidade com link de afiliado",
    legenda:
      `Conheça o material "${produto.nome}". ` +
      `Veja os detalhes: ${produto.linkAfiliado} ` +
      "#Publicidade #LinkDeAfiliado",
    roteiroVideo: {
      formato: "Vertical, sem mostrar o rosto",
      duracao: "15 segundos",
      cena1: "Você gosta de estudar a Bíblia?",
      cena2: "Conheça um material sobre versículos bíblicos",
      cena3: "Confira os detalhes no link da descrição"
    }
  };
}

function gerarVideo() {
  return new Promise((resolve, reject) => {
    const pasta = fs.mkdtempSync(
      path.join(os.tmpdir(), "rendabot-")
    );
    const arquivo = path.join(pasta, "video.mp4");

    const filtro = [
      "drawtext=text='Voce gosta de estudar a Biblia?':",
      "fontcolor=white:fontsize=42:",
      "x=(w-text_w)/2:y=(h-text_h)/2:",
      "enable='between(t,0,5)'",
      ",drawtext=text='Conheca um material sobre versiculos biblicos':",
      "fontcolor=white:fontsize=34:",
      "x=(w-text_w)/2:y=(h-text_h)/2:",
      "enable='between(t,5,10)'",
      ",drawtext=text='Confira o link na descricao':",
      "fontcolor=white:fontsize=42:",
      "x=(w-text_w)/2:y=(h-text_h)/2:",
      "enable='between(t,10,15)'"
    ].join("");

    const args = [
      "-y",
      "-f", "lavfi",
      "-i", "color=c=0x14213d:s=720x1280:r=24:d=15",
      "-vf", filtro,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      arquivo
    ];

    const processo = spawn(ffmpeg, args);
    let erro = "";

    processo.stderr.on("data", dados => {
      erro += dados.toString().slice(-2000);
      if (erro.length > 4000) erro = erro.slice(-4000);
    });

    processo.on("error", error => {
      fs.rmSync(pasta, { recursive: true, force: true });
      reject(error);
    });

    processo.on("close", codigo => {
      if (codigo !== 0) {
        fs.rmSync(pasta, { recursive: true, force: true });
        return reject(
          new Error(`FFmpeg falhou: ${erro.slice(-500)}`)
        );
      }
      resolve({ pasta, arquivo });
    });
  });
}

const server = http.createServer(async (req, res) => {
  const rota = new URL(
    req.url,
    "http://localhost"
  ).pathname;

  if (req.method !== "GET") {
    return sendJSON(res, 405, {
      erro: "Método não permitido"
    });
  }

  if (rota === "/") {
    return sendJSON(res, 200, {
      status: "online",
      app: "RendaBot",
      produtosCadastrados: produtos.length,
      geradorVideo: "disponível"
    });
  }

  if (rota === "/api/status") {
    try {
      await getHotmartToken();
      return sendJSON(res, 200, {
        status: "online",
        hotmart: "conectada",
        token: "gerado"
      });
    } catch (error) {
      return sendJSON(res, 500, {
        status: "erro",
        mensagem: error.message
      });
    }
  }

  if (rota === "/api/products") {
    try {
      const token = await getHotmartToken();
      const response = await fetch(
        "https://developers.hotmart.com/products/api/v1/products?max_results=50",
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json"
          }
        }
      );
      const data = await response.json();

      return sendJSON(res, response.status, data);
    } catch (error) {
      return sendJSON(res, 500, {
        status: "erro",
        mensagem: error.message
      });
    }
  }

  if (rota === "/api/afiliados") {
    return sendJSON(res, 200, {
      total: produtos.length,
      produtos
    });
  }

  if (rota === "/api/conteudos") {
    return sendJSON(res, 200, {
      total: produtos.length,
      conteudos: produtos
        .filter(produto => produto.ativo)
        .map(gerarConteudos)
    });
  }

  if (rota === "/api/video") {
    let resultado;

    try {
      resultado = await gerarVideo();

      const tamanho = fs.statSync(resultado.arquivo).size;

      res.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="rendabot-video.mp4"',
        "Content-Length": tamanho,
        "Cache-Control": "no-store"
      });

      const stream = fs.createReadStream(resultado.arquivo);

      const limpar = () => {
        fs.rm(resultado.pasta, {
          recursive: true,
          force: true
        }, () => {});
      };

      stream.on("error", () => {
        res.destroy();
        limpar();
      });

      res.on("close", limpar);
      stream.pipe(res);
    } catch (error) {
      if (!res.headersSent) {
        return sendJSON(res, 500, {
          status: "erro",
          mensagem: "Não foi possível gerar o vídeo",
          detalhes: error.message
        });
      }
    }

    return;
  }

  return sendJSON(res, 404, {
    erro: "Rota não encontrada"
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`RendaBot online na porta ${PORT}`);
});
