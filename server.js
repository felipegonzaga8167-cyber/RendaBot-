const http = require("http");

const PORT = process.env.PORT || 10000;

async function getHotmartToken() {
  const clientId = process.env.HOTMART_CLIENT_ID;
  const clientSecret = process.env.HOTMART_CLIENT_SECRET;
  const basic = process.env.HOTMART_BASIC;

  if (!clientId || !clientSecret || !basic) {
    throw new Error("Credenciais Hotmart não configuradas no Render");
  }

  const url =
    "https://api-sec-vlc.hotmart.com/security/oauth/token" +
    "?grant_type=client_credentials" +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&client_secret=${encodeURIComponent(clientSecret)}`;

  const authorization = basic.startsWith("Basic ")
    ? basic
    : `Basic ${basic}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": authorization,
      "Content-Type": "application/json"
    }
  });

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
if (req.url === "/api/products") {
  try {
    const token = await getHotmartToken();

    const response = await fetch(
      "https://developers.hotmart.com/products/api/v1/products?max_results=50",
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
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

    res.end(JSON.stringify(data));
  } catch (error) {
    res.statusCode = 500;

    res.end(JSON.stringify({
      status: "erro",
      mensagem: error.message
    }));
  }

  return;

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
