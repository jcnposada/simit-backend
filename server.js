const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/consultar-simit/:cedula', async (req, res) => {
  const { cedula } = req.params;
  let browser;

  try {
    const options = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions'
      ]
    };

    if (process.env.RENDER) {
      options.executablePath = puppeteer.executablePath();
    }

    browser = await puppeteer.launch(options);
    const page = await browser.newPage();

    let jsonRespuesta = null;

    // Escuchar todas las respuestas de red del SIMIT
    page.on('response', async (response) => {
      const url = response.url();
      // Filtrar peticiones a la API backend del SIMIT
      if (url.includes('simit') && (url.includes('estado-cuenta') || url.includes('comparendo') || url.includes('ciudadano'))) {
        try {
          const text = await response.text();
          if (text.startsWith('{') || text.startsWith('[')) {
            const parsed = JSON.parse(text);
            if (parsed) {
              jsonRespuesta = parsed;
            }
          }
        } catch (e) {
          // Ignorar respuestas que no sean JSON válido
        }
      }
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Cargar la página dejando que Angular inicialice correctamente sus scripts
    await page.goto('https://www.fcm.org.co/simit/#/estado-cuenta', {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    // Interactuar con el formulario
    await page.waitForSelector('input', { timeout: 10000 });
    await page.click('input');
    await page.keyboard.type(cedula, { delay: 30 });
    await page.keyboard.press('Enter');

    // Esperar a que la petición XHR complete la respuesta
    let intentos = 0;
    while (!jsonRespuesta && intentos < 15) {
      await new Promise(r => setTimeout(r, 500));
      intentos++;
    }

    let registros = [];

    // 1. Extraer si capturó la API de Angular
    if (jsonRespuesta) {
      const lista = jsonRespuesta.comparendos || jsonRespuesta.multas || jsonRespuesta.resoluciones || (Array.isArray(jsonRespuesta) ? jsonRespuesta : []);
      
      registros = lista.map(item => ({
        numero: item.numeroComparendo || item.numero || item.id || 'N/A',
        tipo: item.tipoSancion || (item.esMulta ? 'Multa' : 'Comparendo'),
        fechaImposicion: item.fechaComparendo || item.fecha || 'N/A',
        placa: item.placa || 'N/A',
        secretaria: item.organismoTransito || 'Tránsito / Movilidad',
        infraccion: item.codigoInfraccion || 'Registrada',
        estado: item.estado || 'Pendiente',
        valorTotal: parseInt(item.valorPagar || item.valorTotal || item.valor || item.totalPagar || 0)
      }));
    }

    // 2. Respaldo por lectura de celdas HTML si el JSON no trajo la estructura esperada
    if (registros.length === 0) {
      registros = await page.evaluate(() => {
        const filas = document.querySelectorAll('tr, mat-row, .cdk-row, .mat-row');
        let encontrados = [];

        filas.forEach(f => {
          const txt = f.innerText || '';
          if (txt.includes('$') || /\d{1,3}(\.\d{3})+/.test(txt)) {
            const matches = txt.match(/\$\s*(\d{1,3}(\.\d{3})+|\d+)/g);
            if (matches) {
              const montos = matches.map(m => parseInt(m.replace(/[^0-9]/g, '')) || 0);
              const maxMonto = Math.max(...montos);
              if (maxMonto > 0) {
                encontrados.push({
                  numero: txt.match(/\b\d{10,20}\b/)?.[0] || 'N/A',
                  tipo: 'Comparendo/Multa',
                  fechaImposicion: txt.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || 'N/A',
                  placa: txt.match(/\b[A-Z]{3}\d{2,3}[A-Z]?\b/)?.[0] || 'N/A',
                  valorTotal: maxMonto
                });
              }
            }
          }
        });

        return Array.from(new Set(encontrados.map(a => a.numero)))
          .map(num => encontrados.find(a => a.numero === num));
      });
    }

    await browser.close();

    const esPaz = registros.length === 0;

    res.json({
      cedula,
      registros,
      esPazYSalvo: esPaz
    });

  } catch (error) {
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    res.status(500).json({ error: "Error consultando el SIMIT", detalle: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));