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
    // 1. Inicializar navegador
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    // 2. Crear página de manera segura
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 3. Navegar a la plataforma SIMIT
    await page.goto('https://www.fcm.org.co/simit/#/estado-cuenta', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // 4. Escribir cédula y presionar Enter
    await page.waitForSelector('input', { timeout: 15000 });
    await page.click('input');
    await page.keyboard.type(cedula, { delay: 60 });
    await page.keyboard.press('Enter');

    // 5. Esperar a que cargue la información visual y se renderice la tabla
    await new Promise(r => setTimeout(r, 4000));
    
    try {
      await page.waitForFunction(
        () => document.body.innerText.includes('$') || document.body.innerText.toLowerCase().includes('no posee'),
        { timeout: 10000 }
      );
    } catch (e) {
      console.log("Esperando tiempo de respaldo...");
    }

    await new Promise(r => setTimeout(r, 3000));

    // 6. Extraer registros
    const resultado = await page.evaluate((cedulaBuscada) => {
      const bodyText = document.body.innerText || '';
      const elementos = document.querySelectorAll('mat-row, .mat-row, tr, app-estado-cuenta, .card, div');
      let registros = [];

      elementos.forEach(el => {
        const texto = el.innerText || '';
        if (texto.includes('$') && (/\d{2}\/\d{2}\/\d{4}/.test(texto) || texto.length > 20)) {
          if (!texto.toLowerCase().includes('estado de cuenta') && !texto.toLowerCase().includes('total a pagar')) {
            const matchesMoneda = texto.match(/\$\s*[\d\.,]+/g);
            let valorFinal = 0;
            
            if (matchesMoneda && matchesMoneda.length > 0) {
              const valorStr = matchesMoneda[matchesMoneda.length - 1].replace(/[^0-9]/g, '');
              valorFinal = parseInt(valorStr) || 0;
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