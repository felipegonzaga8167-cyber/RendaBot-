
const http = require("http");

const PORT = process.env.PORT || 10000;

// Primeiro produto afiliado do RendaBot
const produtos = [
  {
    id: 4814942,
    nome: "Onde está na Bíblia - Versículos bíblicos contra as heresias modernas",
    categoria: "Livros e educação religiosa",
    plataforma: "Hotmart",
    linkAfiliado: "https://go.hotmart.com/F107572734G",
    ativo: true
  }
];

// Autenticação na Hotmart
async function getHotmartToken() {
  const clientId = process.env.HOTMART_CLIENT_ID;
  const clientSecret = process.env.HOTMART_CLIENT_SECRET;
  const basic = process.env.HOTMART_BASIC;

  if (!clientId || !clientSecret || !basic) {
    throw new Error("Credenciais da Hotmart não configuradas");
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

// Respostas em JSON
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(JSON.stringify(data));
}

// Gerador simples de textos de divulgação
function gerarConteudos(produto) {
  return {
    produto: produto.nome,
    link: produto.linkAfiliado,
    aviso: "Conteúdo promocional com link de afiliado",
    legenda:
      `Quer conhecer o material "${produto.nome}"? ` +
      `Veja a descrição e os detalhes no link: ` +
      produto.linkAfiliado +
      " #Publicidade #LinkDeAfiliado",
    roteiroVideo: {
      formato: "Vídeo sem mostrar o rosto",
      cena1: "Exibir o título do material",
      cena2: "Apresentar o tema de forma informativa",
      cena3: "Convidar o público a conhecer a página do produto",
      chamada: "Confira os detalhes no link da descrição"
    }
  };
}

// Servidor
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;

  if (req.method !== "GET") {
    return sendJSON(res, 405, {
      erro: "Método não permitido"
    });
  }

  // Página inicial
  if (path === "/") {
    return sendJSON(res, 200, {
      status: "online",
      app: "RendaBot",
      mensagem: "Servidor funcionando",
      produtosCadastrados: produtos.length
    });
  }

  // Testar autenticação Hotmart
  if (path === "/api/status") {
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
        hotmart: "erro",
        mensagem: error.message
      });
    }
  }

  // Consultar produtos da API Hotmart
  if (path === "/api/products") {
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

      if (!response.ok) {
        return sendJSON(res, response.status, {
          status: "erro",
          mensagem: "Falha ao consultar a Hotmart",
          detalhes: data
        });
      }

      return sendJSON(res, 200, data);
    } catch (error) {
      return sendJSON(res, 500, {
        status: "erro",
        mensagem: error.message
      });
    }
  }

  // Produtos afiliados cadastrados manualmente
  if (path === "/api/afiliados") {
    return sendJSON(res, 200, {
      total: produtos.length,
      produtos: produtos
    });
  }

  // Conteúdos de divulgação
  if (path === "/api/conteudos") {
    const conteudos = produtos
      .filter(produto => produto.ativo)
      .map(gerarConteudos);

    return sendJSON(res, 200, {
      total: conteudos.length,
      conteudos: conteudos
    });
  }

  // Rota não encontrada
  return sendJSON(res, 404, {
    erro: "Rota não encontrada"
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`RendaBot online na porta ${PORT}`);
});
