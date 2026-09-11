const http = require("http");

const PORT = process.env.PORT || 10000;

async function getHotmartToken() {
  const basic = process.env.HOTMART_BASIC;

  if (!basic) {
    throw new Error("HOTMART_BASIC não configurado");
  }

  const response = await fetch(
    "https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials",
    {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basic}`,
        "Content-Type": "application/json"
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Erro Hotmart ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data.access_token;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.url === "/") {
    res.end(JSON.stringify({
      status: "online",
      app: "RendaBot",
      message: "Servidor funcionando"
    }));
    return;
  }

  if (req.url === "/api/status") {
    try {
      const token = await getHotmartToken();

      res.end(JSON.stringify({
        status: "online",
        hotmart: "conectada",
        token: token ? "gerado" : "não gerado"
      }));
    } catch (error) {
      res.statusCode = 500;

      res.end(JSON.stringify({
        status: "online",
        hotmart: "erro",
        mensagem: error.message
      }));
    }

    return;
  }

  res.statusCode = 404;

  res.end(JSON.stringify({
    error: "Rota não encontrada"
  }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`RendaBot online na porta ${PORT}`);
});
