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

    // Esperar y escribir el número de documento
    await page.waitForSelector('input', { timeout: 15000 });
    await page.click('input');
    await page.keyboard.type(cedula, { delay: 40 });
    await page.keyboard.press('Enter');

    // Esperar un tiempo prudente a que los componentes dinámicos de Angular rendericen
    await new Promise(r => setTimeout(r, 6000));

    // Extraer y procesar la información del DOM
    const resultado = await page.evaluate((cedulaBuscada) => {
      const bodyText = document.body.innerText || '';
      
      // Buscar filas en tablas convencionales o en componentes de Angular Material (.mat-row)
      const filas = document.querySelectorAll('table tbody tr, mat-row, .mat-row, .cdk-row');
      let registros = [];

      filas.forEach(row => {
        // Obtener celdas o elementos hijos
        const cols = row.querySelectorAll('td, mat-cell, .mat-cell, div');
        const textoFila = row.innerText || '';

        // Filtrar filas válidas que contengan fechas, montos o estados de tránsito
        if (cols.length >= 4 && (textoFila.includes('$') || /\d{2}\/\d{2}\/\d{4}/.test(textoFila))) {
          // Extraer todos los valores numéricos con formato de moneda encontrados en la fila
          const montos = textoFila.match(/\$\s*[\d\.,]+/g);
          let valor = 0;
          if (montos && montos.length > 0) {
            valor = parseInt(montos[montos.length - 1].replace(/[^0-9]/g, '')) || 0;
          }

          // Determinar si es Comparendo, Multa o Cobro Coactivo
          let tipoEvaluado = 'Multa';
          if (textoFila.toLowerCase().includes('comparendo')) {
            tipoEvaluado = 'Comparendo';
          } else if (textoFila.toLowerCase().includes('coactivo')) {
            tipoEvaluado = 'Cobro Coactivo';
          }

          registros.push({
            numero: textoFila.match(/\b\d{10,20}\b/)?.[0] || 'N/A',
            tipo: tipoEvaluado,
            fechaImposicion: textoFila.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || 'N/A',
            placa: textoFila.match(/\b[A-Z]{3}\d{2,3}[A-Z]?\b/)?.[0] || 'N/A',
            secretaria: 'Tránsito / SIMIT',
            infraccion: textoFila.match(/\b[A-Z]\d{2}\b/)?.[0] || 'Infracción registrada',
            estado: textoFila.toLowerCase().includes('pendiente') ? 'Pendiente' : 'En cobro',
            valorTotal: valor
          });
        }
      });

      // Validar si la cuenta realmente no tiene infracciones
      const esPaz = bodyText.toLowerCase().includes('no posee a la fecha') || 
                    bodyText.toLowerCase().includes('sin comparendos') || 
                    (registros.length === 0 && bodyText.toLowerCase().includes('paz y salvo'));

      return {
        cedula: cedulaBuscada,
        registros: registros,
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