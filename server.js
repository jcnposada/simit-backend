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
        '--single-process'
      ]
    };

    if (process.env.RENDER) {
      options.executablePath = puppeteer.executablePath();
    }

    browser = await puppeteer.launch(options);
    const page = await browser.newPage();

    let apiData = null;

    // Capturar la respuesta JSON interna del SIMIT automáticamente al viajar por la red
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('simit') && (url.includes('estado-cuenta') || url.includes('comparendo') || url.includes('multa') || url.includes('api'))) {
        try {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('application/json')) {
            const json = await response.json();
            if (json && (json.comparendos || json.multas || json.registros || Array.isArray(json))) {
              apiData = json;
            }
          }
        } catch (e) {}
      }
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Ir directo a la interfaz del SIMIT
    await page.goto('https://www.fcm.org.co/simit/#/estado-cuenta', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Esperar a que el input de texto esté completamente disponible en el DOM
    await page.waitForSelector('input', { timeout: 20000 });

    // Enfoque seguro y escritura directa por teclado emulando usuario real
    await page.focus('input');
    await page.keyboard.type(cedula, { delay: 100 });
    
    // Disparar la búsqueda presionando Enter directamente
    await page.keyboard.press('Enter');

    // Esperar de forma dinámica a que la red responda el JSON del SIMIT (máximo 12 segundos)
    let tiempoEspera = 0;
    while (!apiData && tiempoEspera < 12000) {
      await new Promise(r => setTimeout(r, 500));
      tiempoEspera += 500;
    }

    let registros = [];

    // 1. Procesar datos si la red capturó la API oficial
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

    // 2. Si la red no interceptó el JSON, hacer un respaldo leyendo las filas visuales de la tabla
    if (registros.length === 0) {
      registros = await page.evaluate(() => {
        const filas = Array.from(document.querySelectorAll('tr, mat-row, .mat-row, .cdk-row, div'));
        let encontrados = [];

        filas.forEach(f => {
          const txt = f.innerText || '';
          if (txt.includes('$') && (txt.length < 300)) {
            const matches = txt.match(/\$\s*(\d{1,3}(\.\d{3})+|\d+)/g);
            if (matches) {
              const montos = matches.map(m => parseInt(m.replace(/[^0-9]/g, '')) || 0);
              const maxMonto = Math.max(...montos);
              if (maxMonto > 0) {
                encontrados.push({
                  numero: txt.match(/\b\d{10,20}\b/)?.[0] || 'N/A',
                  tipo: /multa/i.test(txt) ? 'Multa' : 'Comparendo',
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