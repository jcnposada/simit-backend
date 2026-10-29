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
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Navegar a la plataforma SIMIT
    await page.goto('https://www.fcm.org.co/simit/#/estado-cuenta', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Escribir el número de documento
    await page.waitForSelector('input', { timeout: 15000 });
    await page.click('input');
    await page.keyboard.type(cedula, { delay: 50 });
    await page.keyboard.press('Enter');

    // Esperar de forma inteligente a que cargue la tabla o aparezca un texto
    try {
      await page.waitForFunction(
        () => {
          const text = document.body.innerText.toLowerCase();
          return document.querySelectorAll('tr, mat-row, .mat-row, .row').length > 3 || 
                 text.includes('comparendo') || 
                 text.includes('multa') || 
                 text.includes('no posee a la fecha');
        },
        { timeout: 12000 }
      );
    } catch (e) {
      console.log("Continuando con la extracción forzada...");
    }

    await new Promise(r => setTimeout(r, 3000));

    // Extraer registros
    const resultado = await page.evaluate((cedulaBuscada) => {
      const bodyText = document.body.innerText || '';
      const filas = document.querySelectorAll('tr, mat-row, .mat-row, .cdk-row, li');
      let registros = [];

      filas.forEach(row => {
        const textoFila = row.innerText || '';
        if (textoFila.length > 15 && (textoFila.includes('$') || /\d{2}\/\d{2}\/\d{4}/.test(textoFila))) {
          if (!textoFila.toLowerCase().includes('estado de cuenta') && !textoFila.toLowerCase().includes('infracción')) {
            
            const montos = textoFila.match(/\$\s*[\d\.,]+/g);
            let valor = 0;
            if (montos && montos.length > 0) {
              valor = parseInt(montos[montos.length - 1].replace(/[^0-9]/g, '')) || 0;
            }

            let tipoSancion = 'Comparendo';
            if (textoFila.toLowerCase().includes('multa')) {
              tipoSancion = 'Multa';
            } else if (textoFila.toLowerCase().includes('coactivo')) {
              tipoSancion = 'Cobro Coactivo';
            }

            registros.push({
              numero: textoFila.match(/\b\d{10,20}\b/)?.[0] || 'N/A',
              tipo: tipoSancion,
              fechaImposicion: textoFila.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || 'N/A',
              placa: textoFila.match(/\b[A-Z]{3}\d{2,3}[A-Z]?\b/)?.[0] || 'N/A',
              secretaria: 'Tránsito / Movilidad',
              infraccion: textoFila.match(/\b[A-Z]\d{2}\b/)?.[0] || 'Registrada',
              estado: textoFila.toLowerCase().includes('pendiente') ? 'Pendiente' : 'Activo',
              valorTotal: valor
            });
          }
        }
      });

      const registrosUnicos = Array.from(new Set(registros.map(a => a.numero)))
        .map(numero => registros.find(a => a.numero === numero));

      const esPaz = bodyText.toLowerCase().includes('no posee a la fecha') && registrosUnicos.length === 0;

      return {
        cedula: cedulaBuscada,
        registros: registrosUnicos,
        esPazYSalvo: esPaz
      };
    }, cedula);

    await browser.close();
    res.json(resultado);

  } catch (error) {
    if (browser) await browser.close();
    res.status(500).json({ error: "Error consultando el SIMIT", detalle: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));