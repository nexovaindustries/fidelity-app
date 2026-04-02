const { PKPass } = require('passkit-generator');
const fs = require('fs');
const env = require('../config/env');

async function fetchImageBuffer(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error('Failed to fetch image:', url, err);
    return null;
  }
}

const generateApplePassBuffer = async (tarjeta) => {
  try {
    const comercio = tarjeta.comercios;
    const cliente = tarjeta.clientes;

    // Lógica de Plantillas (Colors fallback)
    const templateColors = {
      cafeteria: { bg: 'rgb(212, 163, 115)', text: 'rgb(250, 237, 205)' },
      restaurante: { bg: 'rgb(188, 71, 73)', text: 'rgb(242, 232, 207)' },
      peluqueria: { bg: 'rgb(20, 20, 20)', text: 'rgb(255, 255, 255)' },
      estandar: { bg: 'rgb(255, 255, 255)', text: 'rgb(0, 0, 0)' }
    };
    const tpl = comercio.plantilla_diseño || 'estandar';
    const dColors = templateColors[tpl] || templateColors.estandar;

    const backgroundColor = comercio.color_fondo || dColors.bg;
    const foregroundColor = comercio.color_texto || dColors.text;

    // Lógica de Fidelización
    const tipoFidelizacion = comercio.tipo_fidelizacion || 'puntos';
    let mainValue = '';
    let mainLabel = '';

    if (tipoFidelizacion === 'puntos') {
      mainLabel = 'Puntos';
      mainValue = String(tarjeta.puntos_actuales || 0);
    } else if (tipoFidelizacion === 'sellos') {
      mainLabel = 'Sellos';
      const meta = comercio.config_fidelizacion?.meta_sellos || 10;
      mainValue = `${tarjeta.total_sellos || 0} / ${meta}`;
    } else if (tipoFidelizacion === 'niveles') {
      mainLabel = 'Nivel Actual';
      mainValue = tarjeta.nivel_actual || 'Bronce';
    }

    const pass = new PKPass({
      'pass.json': {
        formatVersion: 1,
        passTypeIdentifier: env.apple.passTypeIdentifier,
        teamIdentifier: env.apple.teamIdentifier,
        organizationName: comercio.nombre,
        description: `Tarjeta de Fidelidad - ${comercio.nombre}`,
        backgroundColor,
        foregroundColor,
        labelColor: foregroundColor,
        logoText: comercio.nombre,
        expirationDate: tarjeta.fecha_expiracion ? new Date(tarjeta.fecha_expiracion).toISOString() : undefined,
        storeCard: {
          headerFields: [
            {
              key: "saldo",
              label: mainLabel,
              value: mainValue
            }
          ],
          primaryFields: [
            {
              key: "cliente",
              label: "Cliente",
              value: cliente.nombre_completo
            }
          ],
          secondaryFields: [
            {
              key: "recompensa",
              label: "Modo",
              value: tipoFidelizacion.toUpperCase()
            }
          ],
          auxiliaryFields: tarjeta.fecha_expiracion ? [
            {
              key: "expiracion",
              label: "Válido hasta",
              value: new Date(tarjeta.fecha_expiracion).toLocaleDateString(),
            }
          ] : []
        },
        barcodes: [
          {
            message: tarjeta.qr_value,
            format: "PKBarcodeFormatQR",
            messageEncoding: "iso-8859-1",
            altText: tarjeta.qr_value
          }
        ]
      }
    });

    if (fs.existsSync(env.apple.wwdrPath)) {
      pass.certificates.wwdr = fs.readFileSync(env.apple.wwdrPath);
    }
    if (fs.existsSync(env.apple.signerCertPath)) {
      pass.certificates.signerCert = fs.readFileSync(env.apple.signerCertPath);
    }
    if (fs.existsSync(env.apple.signerKeyPath)) {
      pass.certificates.signerKey = fs.readFileSync(env.apple.signerKeyPath);
    }
    if (env.apple.signerKeyPassphrase) {
       pass.certificates.signerKeyPassphrase = env.apple.signerKeyPassphrase;
    }

    // Cargar Imágenes Remotas
    if (comercio.logo_url) {
      const logoBuf = await fetchImageBuffer(comercio.logo_url);
      if (logoBuf) pass.addBuffer('logo.png', logoBuf);
    }
    if (comercio.hero_image_url) {
      const stripBuf = await fetchImageBuffer(comercio.hero_image_url);
      if (stripBuf) pass.addBuffer('strip.png', stripBuf);
    }

    const passBuffer = await pass.getAsBuffer();
    return passBuffer;

  } catch (error) {
    console.error('Error generando Apple Pass:', error);
    throw new Error('No se pudo generar el archivo .pkpass. Asegúrate de tener los certificados PEM instalados y configurados.');
  }
};

module.exports = {
  generateApplePassBuffer
};
