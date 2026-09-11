const http = require("http");

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
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
    res.end(JSON.stringify({
      status: "online",
      hotmart_configurada: !!process.env.HOTMART_ACCESS_TOKEN
    }));
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
