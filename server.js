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
    
    // Interceptar recursos innecesarios para ahorrar memoria
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.goto('https://www.fcm.org.co/simit/#/estado-cuenta', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Esperar el input, escribir la cédula y presionar Enter
    await page.waitForSelector('input', { timeout: 15000 });
    await page.click('input');
    await page.keyboard.type(cedula, { delay: 50 });
    await page.keyboard.press('Enter');

    // TIEMPO CLAVE: Aumentamos a 12 segundos para que el SIMIT responda la consulta asíncrona
    await new Promise(r => setTimeout(r, 12000));

    // Extraer registros del DOM ya cargado
    const resultado = await page.evaluate((cedulaBuscada) => {
      const bodyText = document.body.innerText || '';
      const nodos = document.querySelectorAll('tr, mat-row, .mat-row, .cdk-row, div, td, app-estado-cuenta div');
      let registros = [];

      nodos.forEach(el => {
        const texto = el.innerText ? el.innerText.trim() : '';
        
        // Buscamos líneas que contengan montos en pesos o símbolos monetarios de multas
        if (texto.includes('$') || /\$\s*\d{1,3}(\.\d{3})+/.test(texto)) {
          if (!texto.toLowerCase().includes('estado de cuenta de infractores') && !texto.toLowerCase().includes('total a pagar')) {
            
            const matchesMoneda = texto.match(/\$\s*(\d{1,3}(\.\d{3})+|\d+)/g);
            let valorEncontrado = 0;

            if (matchesMoneda && matchesMoneda.length > 0) {
              const valoresNumericos = matchesMoneda.map(m => parseInt(m.replace(/[^0-9]/g, '')) || 0);
              valorEncontrado = Math.max(...valoresNumericos);
            }

            if (valorEncontrado > 0) {
              registros.push({
                numero: texto.match(/\b\d{10,20}\b/)?.[0] || 'N/A',
                tipo: /multa/i.test(texto) ? 'Multa' : 'Comparendo',
                fechaImposicion: texto.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || 'N/A',
                placa: texto.match(/\b[A-Z]{3}\d{2,3}[A-Z]?\b/)?.[0] || 'N/A',
                valorTotal: valorEncontrado
              });
            }
          }
        }
      });

      // Eliminar duplicados
      const unicos = Array.from(new Set(registros.map(r => r.numero)))
        .map(num => registros.find(r => r.numero === num));

      // Consideramos paz y salvo SOLO si explícitamente dice el texto de paz y salvo y no hay registros
      const esPazYSalvo = bodyText.toLowerCase().includes('no posee a la fecha') && unicos.length === 0;

      return {
        cedula: cedulaBuscada,
        registros: unicos,
        esPazYSalvo
      };
    }, cedula);

    await browser.close();
    res.json(resultado);

  } catch (error) {
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    res.status(500).json({ error: "Error consultando el SIMIT", detalle: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));