const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/consultar-simit/:cedula', async (req, res) => {
  const { cedula } = req.params;
  let browser;

  console.log(`[LOG] Iniciando consulta para la cédula: ${cedula}`);

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
        '--single-process'
      ]
    };

    if (process.env.RENDER) {
      options.executablePath = puppeteer.executablePath();
    }

    browser = await puppeteer.launch(options);
    const page = await browser.newPage();

    let apiData = null;

    // Escuchar respuestas de red para interceptar el JSON oficial del SIMIT si viaja por XHR
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('simit') && (url.includes('estado-cuenta') || url.includes('comparendo') || url.includes('multa'))) {
        try {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('application/json')) {
            const json = await response.json();
            if (json) {
              apiData = json;
            }
          }
        } catch (e) {}
      }
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    await page.goto('https://www.fcm.org.co/simit/#/estado-cuenta', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await page.waitForSelector('input', { timeout: 20000 });

    await page.focus('input');
    await page.keyboard.type(cedula, { delay: 100 });
    await page.keyboard.press('Enter');

    // Dar tiempo a que Angular pinte los resultados en pantalla y responda la red
    let tiempoEspera = 0;
    while (!apiData && tiempoEspera < 10000) {
      await new Promise(r => setTimeout(r, 500));
      tiempoEspera += 500;
    }

    let registros = [];

    // 1. Procesar si la API devolvió datos directamente
    if (apiData) {
      const lista = apiData.comparendos || apiData.multas || apiData.registros || (Array.isArray(apiData) ? apiData : []);
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

    // 2. Extracción profunda y precisa desde el DOM visual de la tabla del SIMIT
    if (registros.length === 0) {
      registros = await page.evaluate(() => {
        // Buscamos contenedores o filas de la tabla de resultados
        const filas = Array.from(document.querySelectorAll('tr, mat-row, .mat-row, .cdk-row, app-estado-cuenta mat-card, div'));
        let encontrados = [];

        filas.forEach(f => {
          const txt = f.innerText || '';
          // Verificamos que el bloque contenga montos en pesos y tenga un tamaño manejable de tarjeta/fila
          if (txt.includes('$') && txt.length < 500 && !txt.includes('ESTADO DE CUENTA')) {
            const matchesMoneda = txt.match(/\$\s*(\d{1,3}(\.\d{3})+|\d+)/g);
            
            if (matchesMoneda && matchesMoneda.length > 0) {
              const montos = matchesMoneda.map(m => parseInt(m.replace(/[^0-9]/g, '')) || 0);
              const maxMonto = Math.max(...montos);

              if (maxMonto > 0) {
                // Extraer número de comparendo (generalmente de 10 a 15 dígitos)
                const numComparendo = txt.match(/\b\d{10,15}\b/)?.[0] || 'N/A';
                // Extraer fecha (formato dd/mm/yyyy o yyyy-mm-dd)
                const fecha = txt.match(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/)?.[0] || 'N/A';
                // Extraer placa (3 letras seguidas de 2 o 3 números y opcional una letra)
                const placaMatch = txt.match(/\b[A-Z]{3}\s*\d{2,3}[A-Z]?\b/)?.[0] || 'N/A';

                encontrados.push({
                  numero: numComparendo,
                  tipo: /multa/i.test(txt) ? 'Multa' : 'Comparendo',
                  fechaImposicion: fecha,
                  placa: placaMatch.replace(/\s+/g, ''),
                  secretaria: 'Tránsito / Movilidad',
                  infraccion: 'Registrada',
                  estado: 'Pendiente',
                  valorTotal: maxMonto
                });
              }
            }
          }
        });

        // Filtrar duplicados por número de comparendo
        return Array.from(new Set(encontrados.map(a => a.numero)))
          .map(num => encontrados.find(a => a.numero === num));
      });
    }

    await browser.close();

    const esPaz = registros.length === 0;
    console.log(`[LOG] Finalizado. Registros válidos: ${registros.length}`);

    res.json({
      cedula,
      registros,
      esPazYSalvo: esPaz
    });

  } catch (error) {
    console.error('[ERROR CRÍTICO]:', error);
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    res.status(500).json({ error: "Error consultando el SIMIT", detalle: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));