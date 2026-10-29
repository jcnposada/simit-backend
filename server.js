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
    // Iniciar Puppeteer con flags obligatorias para servidores en la nube
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process'
      ]
    });

    const page = await browser.newPage();
    
    // Navegar al SIMIT
    await page.goto(`https://www.fcm.org.co/simit/#/estado-cuenta?txtDocumento=${cedula}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Esperar la carga de la tabla
    await page.waitForTimeout(4000);

    // Extraer registros del DOM
    const resultado = await page.evaluate((cedulaBuscada) => {
      const filas = document.querySelectorAll('table tbody tr');
      let registros = [];

      filas.forEach(row => {
        const cols = row.querySelectorAll('td');
        if (cols.length >= 6) {
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

      return { cedula: cedulaBuscada, registros };
    }, cedula);

    await browser.close();
    res.json(resultado);

  } catch (error) {
    if (browser) await browser.close();
    res.status(500).json({ error: "Error consultando el SIMIT", detalle: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor iniciado en puerto ${PORT}`));