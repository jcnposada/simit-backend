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

    // Escuchar directamente las respuestas XHR/Fetch de la API del SIMIT
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('simit') || url.includes('estado-cuenta') || url.includes('comparendo')) {
        try {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('application/json')) {
            const json = await response.json();
            if (json && (json.comparendos || json.multas || json.registros || Array.isArray(json))) {
              apiData = json;
            }
          }
        } catch (e) {
          // Ignorar respuestas que no sean JSON
        }
      }
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Navegar al portal del SIMIT
    await page.goto('https://www.fcm.org.co/simit/#/estado-cuenta', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Esperar al campo de texto
    const inputSelector = 'input[type="text"], input[formcontrolname], input';
    await page.waitForSelector(inputSelector, { timeout: 15000 });
    
    // Limpiar e ingresar la cédula
    await page.click(inputSelector);
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.type(inputSelector, cedula, { delay: 60 });

    // Buscar y hacer clic explícito en el botón de consulta
    const botonEncontrado = await page.evaluate(() => {
      const botones = Array.from(document.querySelectorAll('button, a, input[type="submit"]'));
      const btn = botones.find(b => {
        const txt = (b.innerText || b.value || '').toLowerCase();
        return txt.includes('consultar') || txt.includes('buscar') || txt.includes('estado de cuenta');
      });
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });

    // Si no encontró botón por texto, presionar Enter
    if (!botonEncontrado) {
      await page.keyboard.press('Enter');
    }

    // Esperar a que la petición asíncrona retorne datos
    let transcurrido = 0;
    while (!apiData && transcurrido < 12000) {
      await new Promise(r => setTimeout(r, 500));
      transcurrido += 500;
    }

    let registros = [];

    // 1. Extraer los datos desde la interceptación de la API JSON
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

    // 2. Respaldo: Extracción desde el DOM
    if (registros.length === 0) {
      registros = await page.evaluate(() => {
        const elementos = Array.from(document.querySelectorAll('tr, mat-row, .mat-row, .cdk-row'));
        let resultado = [];

        elementos.forEach(el => {
          const txt = el.innerText || '';
          if (txt.includes('$') || /\d{1,3}(\.\d{3})+/.test(txt)) {
            const coincidencias = txt.match(/\$\s*(\d{1,3}(\.\d{3})+|\d+)/g);
            if (coincidencias) {
              const valores = coincidencias.map(m => parseInt(m.replace(/[^0-9]/g, '')) || 0);
              const maxVal = Math.max(...valores);
              if (maxVal > 0) {
                resultado.push({
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

        return Array.from(new Set(resultado.map(a => a.numero)))
          .map(num => resultado.find(a => a.numero === num));
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