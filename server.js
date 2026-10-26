
const http = require("http");

const PORT = process.env.PORT || 10000;

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

  if (!response.ok) {
    throw new Error(
      `Erro de autenticação Hotmart: ${response.status}`
    );
  }

  if (!data.access_token) {
    throw new Error("Hotmart não retornou um token");
  }

  return data.access_token;
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });

  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const path = new URL(
    req.url,
    "http://localhost"
  ).pathname;

  if (path === "/") {
    return sendJSON(res, 200, {
      status: "online",
      app: "RendaBot",
      message: "Servidor funcionando"
    });
  }

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

  if (path === "/api/products") {
    try {
      const token = await getHotmartToken();

      const response = await fetch(
        "https://developers.hotmart.com/products/api/v1/products?max_results=50",
        {
          method: "GET",
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
          mensagem: "Falha ao consultar produtos da Hotmart",
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

  return sendJSON(res, 404, {
    error: "Rota não encontrada"
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`RendaBot online na porta ${PORT}`);
});
