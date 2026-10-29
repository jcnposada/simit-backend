const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/consultar-simit/:cedula', async (req, res) => {
  const { cedula } = req.params;

  try {
    // Petición directa al endpoint público que consume el SIMIT internamente
    const response = await axios.get(
      `https://servicios.fcm.org.co/simit/api/estado-cuenta/${cedula}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Origin': 'https://www.fcm.org.co',
          'Referer': 'https://www.fcm.org.co/simit/'
        },
        timeout: 15000
      }
    );

    const data = response.data;
    let registros = [];

    // Mapeo de la estructura oficial que devuelve la API del SIMIT
    if (data && (data.comparendos || data.multas || Array.isArray(data))) {
      const lista = data.comparendos || data.multas || data;

      registros = lista.map(item => ({
        numero: item.numeroComparendo || item.numero || item.id || 'N/A',
        tipo: item.tipoSancion || (item.esMulta ? 'Multa' : 'Comparendo'),
        fechaImposicion: item.fechaComparendo || item.fecha || 'N/A',
        placa: item.placa || 'N/A',
        secretaria: item.organismoTransito || item.secretaria || 'Tránsito / Movilidad',
        infraccion: item.codigoInfraccion || item.infraccion || 'Registrada',
        estado: item.estado || 'Pendiente',
        valorTotal: parseInt(item.valorPagar || item.valorTotal || item.valor || 0)
      }));
    }

    const esPaz = registros.length === 0;

    res.json({
      cedula,
      origen: 'api-directa',
      registros,
      esPazYSalvo: esPaz
    });

  } catch (error) {
    // Si la API directa falla o tiene restricción de IP, devolvemos un mensaje estructurado
    console.error("Error en consulta directa:", error.message);
    res.status(500).json({ 
      error: "Error consultando la API del SIMIT", 
      detalle: error.response?.data || error.message 
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));