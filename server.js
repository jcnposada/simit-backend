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
    
    let datosCapurados = null;

    // Interceptar las respuestas HTTP de la página para atrapar el JSON del SIMIT
    page.on('response', async (response) => {
      const url = response.url();
      // Detectar la respuesta API que contiene el estado de cuenta
      if (url.includes('estado-cuenta') || url.includes('comparendos') || url.includes('simit/api')) {
        try {
          const contentType = response.headers()['content-type'];
          if (contentType && contentType.includes('application/json')) {
            const json = await response.json();
            if (json && (json.comparendos || json.multas || Array.isArray(json) || json.registros)) {
              datosCapurados = json;
            }
          }
        } catch (e) {
          // Ignorar respuestas que no sean JSON válido
        }
      }
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.goto('https://www.fcm.org.co/simit/#/estado-cuenta', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Ingresar cédula en el formulario
    await page.waitForSelector('input', { timeout: 15000 });
    await page.click('input');
    await page.keyboard.type(cedula, { delay: 40 });
    await page.keyboard.press('Enter');

    // Esperar a que se complete la petición de red
    await new Promise(r => setTimeout(r, 10000));

    let registros = [];

    // 1. Si capturamos la respuesta de la API JSON interna
    if (datosCapurados) {
      const lista = datosCapurados.comparendos || datosCapurados.multas || datosCapurados.registros || (Array.isArray(datosCapurados) ? datosCapurados : []);
      
      registros = lista.map(item => ({
        numero: item.numeroComparendo || item.numero || item.id || 'N/A',
        tipo: item.tipoSancion || (item.esMulta ? 'Multa' : 'Comparendo'),
        fechaImposicion: item.fechaComparendo || item.fecha || 'N/A',
        placa: item.placa || 'N/A',
        secretaria: item.organismoTransito || 'Tránsito / Movilidad',
        infraccion: item.codigoInfraccion || 'Registrada',
        estado: item.estado || 'Pendiente',
        valorTotal: parseInt(item.valorPagar || item.valorTotal || item.valor || 0)
      }));
    }

    // 2. Respaldo: Si la red no capturó el JSON, hacer un barrido profundo de inputs y celdas
    if (registros.length === 0) {
      registros = await page.evaluate(() => {
        const celdas = Array.from(document.querySelectorAll('tr, mat-row, .mat-row, td, div'));
        let enc = [];
        
        celdas.forEach(el => {
          const txt = el.innerText || '';
          if (txt.includes('$')) {
            const matches = txt.match(/\$\s*(\d{1,3}(\.\d{3})+|\d+)/g);
            if (matches) {
              const vals = matches.map(m => parseInt(m.replace(/[^0-9]/g, '')) || 0);
              const maxVal = Math.max(...vals);
              if (maxVal > 0) {
                enc.push({
                  numero: txt.match(/\b\d{10,20}\b/)?.[0] || 'N/A',
                  tipo: 'Comparendo/Multa',
                  fechaImposicion: txt.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || 'N/A',
                  placa: txt.match(/\b[A-Z]{3}\d{2,3}[A-Z]?\b/)?.[0] || 'N/A',
                  valorTotal: maxVal
                });
              }
            }
          }
        });

        return Array.from(new Set(enc.map(a => a.numero)))
          .map(num => enc.find(a => a.numero === num));
      });
    }

    const esPaz = registros.length === 0;

    await browser.close();

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