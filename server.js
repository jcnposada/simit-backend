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
    
    // Interceptar para aligerar recursos
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

    await page.waitForSelector('input', { timeout: 15000 });
    await page.click('input');
    await page.keyboard.type(cedula, { delay: 40 });
    await page.keyboard.press('Enter');

    // Damos un tiempo prudente para que Angular pinte las tablas en pantalla
    await new Promise(r => setTimeout(r, 8000));

    // Extraer todo el contenido visible para analizar los bloques de multas
    const resultado = await page.evaluate((cedulaBuscada) => {
      const bodyText = document.body.innerText || '';
      
      // Capturamos cualquier contenedor de filas o tarjetas de la interfaz
      const elementos = document.querySelectorAll('tr, mat-row, .mat-row, .cdk-row, app-estado-cuenta div, mat-card');
      let registros = [];

      elementos.forEach(el => {
        const texto = el.innerText ? el.innerText.trim() : '';
        
        // Buscamos bloques que contengan signos de peso o estructura de valores monetarios
        if (texto.includes('$') || /\$\s*\d{1,3}(\.\d{3})+/.test(texto) || /total a pagar/i.test(texto)) {
          // Filtramos cabeceras genéricas
          if (!texto.toLowerCase().includes('estado de cuenta de infractores')) {
            
            // Extraer todos los números que parezcan montos en pesos
            const matchesMoneda = texto.match(/\$\s*(\d{1,3}(\.\d{3})+|\d+)/g);
            let valorEncontrado = 0;

            if (matchesMoneda && matchesMoneda.length > 0) {
              const valoresNumericos = matchesMoneda.map(m => parseInt(m.replace(/[^0-9]/g, '')) || 0);
              valorEncontrado = Math.max(...valoresNumericos);
            }

            if (valorEncontrado > 0) {
              registros.push({
                textoCompletoBloque: texto.substring(0, 150), // Para depurar qué capturó
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

      // Eliminar duplicados basándose en el número de comparendo/multa
      const unicos = Array.from(new Set(registros.map(r => r.numero)))
        .map(num => registros.find(r => r.numero === num));

      const esPazYSalvo = bodyText.toLowerCase().includes('no posee a la fecha') && unicos.length === 0;

      return {
        cedula: cedulaBuscada,
        rawBodySample: bodyText.substring(0, 400), // Muestra del texto general de la web
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