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
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Ingresar cédula
    await page.waitForSelector('input', { timeout: 15000 });
    await page.click('input');
    await page.keyboard.type(cedula, { delay: 60 });
    await page.keyboard.press('Enter');

    // Esperar a que el SIMIT procese la respuesta
    await new Promise(r => setTimeout(r, 7000));

    // Extraer datos analizando el texto global y las celdas
    const resultado = await page.evaluate((cedulaBuscada) => {
      const bodyText = document.body.innerText || '';
      const nodos = document.querySelectorAll('tr, mat-row, .mat-row, .cdk-row, div, td');
      let registros = [];

      nodos.forEach(el => {
        const texto = el.innerText || '';
        
        // Si el texto contiene valores numéricos significativos o signos de moneda
        if (texto.length > 15 && (texto.includes('$') || /\d{1,3}(\.\d{3})+/.test(texto))) {
          if (!texto.toLowerCase().includes('estado de cuenta') && !texto.toLowerCase().includes('total a pagar')) {
            
            // Buscar patrones de moneda o números grandes que representan el valor
            const coincidencias = texto.match(/\$?\s*(\d{1,3}(\.\d{3})+|\d{4,9})/g);
            let valorFinal = 0;

            if (coincidencias && coincidencias.length > 0) {
              // Tomamos el valor numérico más alto encontrado en la fila
              const valores = coincidencias.map(c => parseInt(c.replace(/[^0-9]/g, '')) || 0);
              valorFinal = Math.max(...valores);
            }

            if (valorFinal > 0) {
              registros.push({
                numero: texto.match(/\b\d{10,20}\b/)?.[0] || 'N/A',
                tipo: texto.toLowerCase().includes('multa') ? 'Multa' : 'Comparendo',
                fechaImposicion: texto.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || 'N/A',
                placa: texto.match(/\b[A-Z]{3}\d{2,3}[A-Z]?\b/)?.[0] || 'N/A',
                secretaria: 'Tránsito / Movilidad',
                infraccion: 'Registrada',
                estado: 'Pendiente',
                valorTotal: valorFinal
              });
            }
          }
        }
      });

      // Filtrar registros duplicados por número de comparendo
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
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    res.status(500).json({ error: "Error consultando el SIMIT", detalle: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));