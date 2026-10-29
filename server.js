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

    // Navegar al SIMIT
    await page.goto('https://www.fcm.org.co/simit/#/estado-cuenta', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Escribir la cédula o placa en el buscador del SIMIT
    await page.waitForSelector('input', { timeout: 15000 });
    await page.click('input');
    await page.keyboard.type(cedula, { delay: 50 });
    await page.keyboard.press('Enter');

    // Esperar a que la tabla cargue los resultados o el mensaje de paz y salvo
    try {
      await page.waitForFunction(
        () => document.querySelectorAll('table tbody tr').length > 0 || document.body.innerText.includes('no posee a la fecha'),
        { timeout: 15000 }
      );
    } catch (e) {
      console.log("Tiempo de espera agotado para la tabla, extrayendo datos disponibles...");
    }

    // Extraer tanto comparendos como multas del DOM de la tabla
    const resultado = await page.evaluate((cedulaBuscada) => {
      const filas = document.querySelectorAll('table tbody tr');
      let registros = [];

      filas.forEach(row => {
        const cols = row.querySelectorAll('td');
        // Validamos que la fila tenga celdas suficientes con datos de multas/comparendos
        if (cols.length >= 6) {
          const textoFila = row.innerText.toLowerCase();
          
          registros.push({
            numero: cols[0]?.innerText.trim() || '',
            // Identifica si es Comparendo, Multa o Coactivo de forma flexible
            tipo: textoFila.includes('comparendo') ? 'Comparendo' : (textoFila.includes('multa') ? 'Multa' : 'Obligación Tránsito'),
            fechaImposicion: cols[0]?.innerText.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || '',
            placa: cols[2]?.innerText.trim() || 'N/A',
            secretaria: cols[3]?.innerText.trim() || 'N/A',
            infraccion: cols[4]?.innerText.trim() || 'N/A',
            estado: cols[5]?.innerText.trim() || 'Pendiente',
            // Captura el valor total limpiando signos de moneda y puntos
            valorTotal: parseInt(cols[6]?.innerText.replace(/[^0-9]/g, '') || cols[7]?.innerText.replace(/[^0-9]/g, '') || '0')
          });
        }
      });

      return { 
        cedula: cedulaBuscada, 
        registros,
        esPazYSalvo: document.body.innerText.includes('no posee a la fecha')
      };
    }, cedula);

    await browser.close();
    res.json(resultado);

  } catch (error) {
    if (browser) await browser.close();
    res.status(500).json({ error: "Error consultando el SIMIT", detalle: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor SIMIT activo en puerto ${PORT}`));