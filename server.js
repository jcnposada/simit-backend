const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/consultar-simit/:cedula', async (req, res) => {
  const { cedula } = req.params;
  let browser;

  console.log(`[LOG] Consultando cédula en SIMIT: ${cedula}`);

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

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Navegar al SIMIT
    await page.goto('https://www.fcm.org.co/simit/#/estado-cuenta', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Ingresar cédula
    await page.waitForSelector('input', { timeout: 20000 });
    await page.focus('input');
    await page.keyboard.type(cedula, { delay: 100 });
    await page.keyboard.press('Enter');

    // Esperar a que la tabla de Angular renderice los datos completos (12 segundos)
    await new Promise(r => setTimeout(r, 12000));

    // Extracción avanzada desde los elementos reales del DOM del SIMIT
    const registros = await page.evaluate(() => {
      let resultados = [];
      
      // Buscamos filas de tablas o tarjetas donde el SIMIT despliega los comparendos
      const filas = Array.from(document.querySelectorAll('tr, mat-row, .mat-row, .cdk-row, app-estado-cuenta div, .card, ion-card'));

      filas.forEach((fila, index) => {
        const textoFila = fila.innerText || '';
        
        // Verificamos que la fila hable de comparendos/multas y tenga valores monetarios
        if ((textoFila.includes('Comparendo') || textoFila.includes('Multa') || textoFila.includes('$')) && textoFila.length < 800) {
          
          // Extraer todos los montos en formato de dinero o números grandes
          const matchesMoneda = textoFila.match(/\$\s*(\d{1,3}(\.\d{3})+|\d+)/g);
          let valorFinal = 0;

          if (matchesMoneda && matchesMoneda.length > 0) {
            const valores = matchesMoneda.map(m => parseInt(m.replace(/[^0-9]/g, '')) || 0);
            valorFinal = Math.max(...valores);
          }

          // Si encontramos un valor válido superior a cero
          if (valorFinal > 0) {
            // Buscar número de comparendo (de 10 a 20 dígitos)
            const numeroComp = textoFila.match(/\b\d{10,20}\b/)?.[0] || `SIMIT-${index + 1}`;
            // Buscar fecha
            const fechaComp = textoFila.match(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/)?.[0] || 'Reciente';
            // Buscar placa de vehículo
            const placaComp = textoFila.match(/\b[A-Z]{3}\s*\d{2,3}[A-Z]?\b/)?.[0] || 'N/A';

            resultados.push({
              numero: numeroComp.trim(),
              tipo: textoFila.toLowerCase().includes('multa') ? 'Multa' : 'Comparendo',
              fechaImposicion: fechaComp,
              placa: placaComp.replace(/\s+/g, ''),
              secretaria: 'Tránsito / Movilidad',
              infraccion: 'Infracción de tránsito',
              estado: 'Pendiente',
              valorTotal: valorFinal
            });
          }
        }
      });

      // Eliminar elementos duplicados basados en el número o valor exacto
      const unicos = [];
      const mapValores = new Set();
      
      resultados.forEach(item => {
        if (!mapValores.has(item.valorTotal)) {
          mapValores.add(item.valorTotal);
          unicos.push(item);
        }
      });

      return unicos;
    });

    await browser.close();

    const esPazYSalvo = registros.length === 0;

    console.log(`[LOG] Consulta finalizada con éxito. Registros reales: ${registros.length}`);

    res.json({
      cedula,
      registros,
      esPazYSalvo
    });

  } catch (error) {
    console.error('[ERROR CRÍTICO]:', error);
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    res.status(500).json({ error: "Error consultando el SIMIT", detalle: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));