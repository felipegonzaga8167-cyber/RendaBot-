
function gerarVideo() {
  return new Promise((resolve, reject) => {
    const pasta = fs.mkdtempSync(
      path.join(os.tmpdir(), "rendabot-")
    );

    const arquivo = path.join(pasta, "video.mp4");

    const largura = 720;
    const altura = 1280;

    // Cria imagens PPM sem precisar de bibliotecas extras
    function criarTela(nome, cor) {
      const destino = path.join(pasta, nome);
      const cabecalho = Buffer.from(
        `P6\n${largura} ${altura}\n255\n`
      );

      const pixels = Buffer.alloc(largura * altura * 3);

      for (let i = 0; i < pixels.length; i += 3) {
        pixels[i] = cor[0];
        pixels[i + 1] = cor[1];
        pixels[i + 2] = cor[2];
      }

      fs.writeFileSync(
        destino,
        Buffer.concat([cabecalho, pixels])
      );

      return destino;
    }

    // Três cenas com cores diferentes
    const tela1 = criarTela("cena1.ppm", [20, 33, 61]);
    const tela2 = criarTela("cena2.ppm", [29, 53, 87]);
    const tela3 = criarTela("cena3.ppm", [43, 70, 105]);

    const lista = path.join(pasta, "cenas.txt");

    const conteudo = [
      `file '${tela1}'`,
      "duration 5",
      `file '${tela2}'`,
      "duration 5",
      `file '${tela3}'`,
      "duration 5",
      `file '${tela3}'`
    ].join("\n");

    fs.writeFileSync(lista, conteudo);

    const args = [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", lista,
      "-vf", "fps=24,format=yuv420p",
      "-t", "15",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-movflags", "+faststart",
      arquivo
    ];

    const processo = spawn(ffmpeg, args);
    let erro = "";

    processo.stderr.on("data", dados => {
      erro += dados.toString();
      if (erro.length > 4000) {
        erro = erro.slice(-4000);
      }
    });

    processo.on("error", error => {
      fs.rmSync(pasta, {
        recursive: true,
        force: true
      });
      reject(error);
    });

    processo.on("close", codigo => {
      if (codigo !== 0) {
        fs.rmSync(pasta, {
          recursive: true,
          force: true
        });

        return reject(
          new Error(`FFmpeg falhou: ${erro.slice(-500)}`)
        );
      }

      resolve({ pasta, arquivo });
    });
  });
}
