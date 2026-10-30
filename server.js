const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/consultar-simit/:cedula', async (req, res) => {
  const { cedula } = req.params;
  let browser;

  console.log(`[LOG] Iniciando consulta para documento: ${cedula}`);

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

    // Enmascarar el agente para evitar bloqueos primarios de bot
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Interceptar cabeceras para simular un navegador real completo
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'es-ES,es;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/png,*/*;q=0.8'
    });

    // Cargar directamente la URL de servicios o estado de cuenta del SIMIT
    await page.goto('https://www.fcm.org.co/simit/#/estado-cuenta', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await page.waitForSelector('input', { timeout: 20000 });
    await page.focus('input');
    await page.keyboard.type(cedula, { delay: 100 });
    await page.keyboard.press('Enter');

    // Dar tiempo prudente para la carga asíncrona de Angular
    await new Promise(r => setTimeout(r, 10000));

    // Evaluar si aparece el texto explícito de bloqueo o restricción de Cloudflare/SIMIT
    const contenidoPagina = await page.evaluate(() => document.body.innerText || '');
    
    if (contenidoPagina.includes('Access Denied') || contenidoPagina.includes('bloqueado') || contenidoPagina.length < 200) {
      await browser.close();
      return res.status(403).json({ 
        error: "El servidor oficial del SIMIT ha restringido temporalmente las consultas automatizadas desde este nodo. Por favor, intenta nuevamente más tarde." 
      });
    }

    // Extracción estricta de registros reales
    const registros = await page.evaluate(() => {
      let encontrados = [];
      const filas = Array.from(document.querySelectorAll('tr, mat-row, .mat-row, .cdk-row'));

      filas.forEach((el) => {
        const texto = el.innerText || '';
        if (texto.includes('$') && texto.length < 500) {
          const matches = texto.match(/\$\s*(\d{1,3}(\.\d{3})+|\d+)/g);
          if (matches) {
            const valores = matches.map(m => parseInt(m.replace(/[^0-9]/g, '')) || 0);
            const maxVal = Math.max(...valores);

            if (maxVal > 0) {
              encontrados.push({
                numero: texto.match(/\b\d{10,20}\b/)?.[0] || 'N/A',
                tipo: /multa/i.test(texto) ? 'Multa' : 'Comparendo',
                fechaImposicion: texto.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || 'Reciente',
                placa: texto.match(/\b[A-Z]{3}\s*\d{2,3}[A-Z]?\b/)?.[0] || 'N/A',
                secretaria: 'Tránsito / Movilidad',
                infraccion: 'Infracción de tránsito',
                estado: 'Pendiente',
                valorTotal: maxVal
              });
            }
          }
        }
      });

      // Filtrar duplicados exactos
      const unicos = [];
      const mapVal = new Set();
      encontrados.forEach(item => {
        if (!mapVal.has(item.valorTotal)) {
          mapVal.add(item.valorTotal);
          unicos.push(item);
        }
      });

      return unicos;
    });

    await browser.close();

    const esPazYSalvo = registros.length === 0;

    res.json({
      cedula,
      registros,
      esPazYSalvo
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