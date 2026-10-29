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
    // Iniciar Puppeteer optimizado para servidores gratuitos
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

    // Configurar un User-Agent real para evitar bloqueos por seguridad
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Navegar al SIMIT con tolerancia de carga
    await page.goto('https://www.fcm.org.co/simit/#/estado-cuenta', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Esperar a que aparezca el campo de texto de búsqueda de la cédula
    await page.waitForSelector('input', { timeout: 15000 });

    // Escribir la cédula o placa en el input del SIMIT
    const inputSelector = 'input'; // Selector general del buscador
    await page.click(inputSelector);
    await page.keyboard.type(cedula, { delay: 50 });

    // Presionar la tecla Enter o buscar el botón de la lupa para ejecutar la consulta
    await page.keyboard.press('Enter');

    // Esperar a que la tabla de resultados o el mensaje de paz y salvo aparezca
    try {
      await page.waitForFunction(
        () => document.querySelectorAll('table tbody tr').length > 0 || document.body.innerText.includes('no posee a la fecha'),
        { timeout: 15000 }
      );
    } catch (e) {
      console.log("No se detectó tabla inmediata, extrayendo contenido disponible...");
    }

    // Extraer los datos reales del DOM de la página del SIMIT
    const resultado = await page.evaluate((cedulaBuscada) => {
      const filas = document.querySelectorAll('table tbody tr');
      let registros = [];

      filas.forEach(row => {
        const cols = row.querySelectorAll('td');
        if (cols.length >= 7) {
          registros.push({
            numero: cols[0]?.innerText.trim() || '',
            tipo: cols[0]?.innerText.toLowerCase().includes('comparendo') ? 'Comparendo' : 'Cobro coactivo',
            fechaImposicion: cols[0]?.innerText.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || '',
            placa: cols[2]?.innerText.trim() || '',
            secretaria: cols[3]?.innerText.trim() || '',
            infraccion: cols[4]?.innerText.trim() || '',
            estado: cols[5]?.innerText.trim() || '',
            valorTotal: parseInt(cols[6]?.innerText.replace(/[^0-9]/g, '') || '0')
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