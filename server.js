// Extraer registros mediante búsqueda directa de montos y patrones en todo el documento
    const resultado = await page.evaluate((cedulaBuscada) => {
      const bodyText = document.body.innerText || '';
      
      // Capturar todos los bloques de texto que parezcan una infracción o contenedor de multa
      const elementos = document.querySelectorAll('mat-row, .mat-row, tr, app-estado-cuenta, .card, div');
      let registros = [];

      elementos.forEach(el => {
        const texto = el.innerText || '';
        // Validar si el bloque contiene un monto en pesos y una fecha o número de comparendo
        if (texto.includes('$') && (/\d{2}\/\d{2}\/\d{4}/.test(texto) || texto.length > 20)) {
          if (!texto.toLowerCase().includes('estado de cuenta') && !texto.toLowerCase().includes('total a pagar')) {
            
            // Buscar todos los montos con formato de moneda dentro de este bloque
            const matchesMoneda = texto.match(/\$\s*[\d\.,]+/g);
            let valorFinal = 0;
            
            if (matchesMoneda && matchesMoneda.length > 0) {
              // Tomar el último monto encontrado (suele ser el valor total a pagar de la infracción)
              const valorStr = matchesMoneda[matchesMoneda.length - 1].replace(/[^0-9]/g, '');
              valorFinal = parseInt(valorStr) || 0;
            }

            // Si encontramos un valor mayor a cero, es un registro válido
            if (valorFinal > 0) {
              registros.push({
                numero: texto.match(/\b\d{10,20}\b/)?.[0] || 'N/A',
                tipo: texto.toLowerCase().includes('multa') ? 'Multa' : 'Comparendo',
                fechaImposicion: texto.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || 'N/A',
                placa: texto.match(/\b[A-Z]{3}\d{2,3}[A-Z]?\b/)?.[0] || 'N/A',
                secretaria: 'Tránsito / Movilidad',
                infraccion: texto.match(/\b[A-Z]\d{2}\b/)?.[0] || 'Registrada',
                estado: 'Pendiente',
                valorTotal: valorFinal
              });
            }
          }
        }
      });

      // Eliminar duplicados basándose en el número de sanción
      const registrosUnicos = Array.from(new Set(registros.map(a => a.numero)))
        .map(numero => registros.find(a => a.numero === numero));

      const esPaz = bodyText.toLowerCase().includes('no posee a la fecha') && registrosUnicos.length === 0;

      return {
        cedula: cedulaBuscada,
        registros: registrosUnicos,
        esPazYSalvo: esPaz
      };
    }, cedula);