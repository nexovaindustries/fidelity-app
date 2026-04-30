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

/** Convierte hex (#RRGGBB) a formato rgb() requerido por Apple Wallet */
function toRgb(hexOrRgb, fallback) {
  if (!hexOrRgb) return fallback;
  if (hexOrRgb.startsWith('rgb')) return hexOrRgb;
  const r = parseInt(hexOrRgb.slice(1, 3), 16);
  const g = parseInt(hexOrRgb.slice(3, 5), 16);
  const b = parseInt(hexOrRgb.slice(5, 7), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return fallback;
  return `rgb(${r}, ${g}, ${b})`;
}

/** Calcula el estado de progreso del cliente para mostrar en la tarjeta */
function getProgressInfo(tarjeta, comercio) {
  const tipo = comercio.tipo_fidelizacion || 'puntos';
  const config = comercio.config_fidelizacion || {};

  if (tipo === 'sellos') {
    const meta = config.meta_sellos || 10;
    const current = tarjeta.total_sellos || 0;
    const faltan = Math.max(0, meta - current);
    return {
      headerLabel: 'Sellos',
      headerValue: `${current} / ${meta}`,
      nextRewardLabel: faltan === 0 ? '¡Premio listo!' : 'Faltan',
      nextRewardValue: faltan === 0 ? 'Muéstralo al cajero' : `${faltan} sello${faltan !== 1 ? 's' : ''}`,
      rewardDescription: config.descripcion_recompensa || `Completa ${meta} sellos y gana tu premio`,
    };
  }

  if (tipo === 'niveles') {
    const current = tarjeta.puntos_actuales || 0;
    const nivel = tarjeta.nivel_actual || 'Bronce';
    let nextLabel, nextValue;
    if (current < 500) { nextLabel = 'Para Plata'; nextValue = `${500 - current} pts`; }
    else if (current < 1000) { nextLabel = 'Para Oro'; nextValue = `${1000 - current} pts`; }
    else { nextLabel = '¡Nivel Máximo!'; nextValue = 'Eres nuestro top'; }
    return {
      headerLabel: 'Nivel',
      headerValue: nivel,
      nextRewardLabel: nextLabel,
      nextRewardValue: nextValue,
      rewardDescription: config.descripcion_recompensa || 'Disfruta los beneficios exclusivos de tu membresía',
    };
  }

  // puntos (default)
  const meta = config.puntos_para_recompensa || 100;
  const current = tarjeta.puntos_actuales || 0;
  const ciclo = current % meta;
  const faltan = meta - ciclo;
  return {
    headerLabel: 'Puntos',
    headerValue: String(current),
    nextRewardLabel: faltan === meta ? '¡Canjea ahora!' : 'Próx. recompensa',
    nextRewardValue: faltan === meta ? 'Premio disponible' : `en ${faltan} pts`,
    rewardDescription: config.descripcion_recompensa || `Acumula ${meta} puntos y canjea tu recompensa`,
  };
}

const generateApplePassBuffer = async (tarjeta) => {
  try {
    const comercio = tarjeta.comercios;
    const cliente = tarjeta.clientes;

    // Paletas de color por industria (rgb para Apple Wallet)
    const templateColors = {
      cafeteria:   { bg: 'rgb(44, 26, 14)',    text: 'rgb(245, 222, 179)', accent: 'rgb(200, 148, 58)' },
      restaurante: { bg: 'rgb(26, 5, 5)',      text: 'rgb(245, 230, 211)', accent: 'rgb(192, 57, 43)' },
      peluqueria:  { bg: 'rgb(17, 17, 17)',    text: 'rgb(245, 245, 245)', accent: 'rgb(201, 176, 55)' },
      spa:         { bg: 'rgb(18, 48, 42)',    text: 'rgb(232, 245, 240)', accent: 'rgb(76, 175, 154)' },
      boutique:    { bg: 'rgb(26, 15, 46)',    text: 'rgb(237, 224, 255)', accent: 'rgb(168, 85, 247)' },
      gimnasio:    { bg: 'rgb(10, 10, 10)',    text: 'rgb(245, 245, 245)', accent: 'rgb(239, 68, 68)' },
      bar:         { bg: 'rgb(13, 11, 24)',    text: 'rgb(232, 213, 163)', accent: 'rgb(245, 158, 11)' },
      hotel:       { bg: 'rgb(24, 20, 15)',    text: 'rgb(245, 236, 215)', accent: 'rgb(191, 161, 115)' },
      farmacia:    { bg: 'rgb(10, 35, 24)',    text: 'rgb(209, 250, 229)', accent: 'rgb(34, 197, 94)' },
      tecnologia:  { bg: 'rgb(6, 13, 31)',     text: 'rgb(191, 219, 254)', accent: 'rgb(59, 130, 246)' },
      panaderia:   { bg: 'rgb(45, 27, 16)',    text: 'rgb(254, 243, 199)', accent: 'rgb(217, 119, 6)' },
      libreria:    { bg: 'rgb(30, 27, 75)',    text: 'rgb(237, 233, 254)', accent: 'rgb(129, 140, 248)' },
      estandar:    { bg: 'rgb(255, 255, 255)', text: 'rgb(26, 26, 26)',    accent: 'rgb(99, 102, 241)' },
    };

    // Soportar tanto plantilla_diseno como plantilla_diseño (bug histórico de naming)
    const tpl = comercio.plantilla_diseno || comercio.plantilla_diseño || 'estandar';
    const dColors = templateColors[tpl] || templateColors.estandar;

    const backgroundColor = toRgb(comercio.color_fondo, dColors.bg);
    const foregroundColor = toRgb(comercio.color_texto, dColors.text);
    const labelColor      = toRgb(comercio.color_acento, dColors.accent);

    const progress = getProgressInfo(tarjeta, comercio);

    // Campos del reverso (visibles al tocar el ícono "i" en Apple Wallet)
    const backFields = [
      {
        key: 'descripcion_programa',
        label: 'Cómo ganar tu recompensa',
        value: progress.rewardDescription,
      },
    ];

    if (comercio.telefono) {
      backFields.push({
        key: 'telefono',
        label: 'Teléfono',
        value: comercio.telefono,
        dataDetectorTypes: ['PKDataDetectorTypePhoneNumber'],
      });
    }

    if (comercio.sitio_web) {
      backFields.push({
        key: 'web',
        label: 'Sitio Web',
        value: comercio.sitio_web,
        dataDetectorTypes: ['PKDataDetectorTypeLink'],
      });
    }

    backFields.push({
      key: 'terminos',
      label: 'Términos y Condiciones',
      value: `Esta tarjeta es personal e intransferible. ${comercio.nombre} se reserva el derecho de modificar los términos del programa de fidelidad en cualquier momento. Los puntos/sellos/niveles acumulados no tienen valor monetario y no son canjeables por efectivo.`,
    });

    const pass = new PKPass({
      'pass.json': {
        formatVersion: 1,
        serialNumber: tarjeta.id,
        passTypeIdentifier: env.apple.passTypeIdentifier,
        teamIdentifier: env.apple.teamIdentifier,
        organizationName: comercio.nombre,
        description: `${comercio.slogan || 'Tarjeta de Fidelidad'} — ${comercio.nombre}`,
        backgroundColor,
        foregroundColor,
        labelColor,
        logoText: comercio.nombre,
        expirationDate: tarjeta.fecha_expiracion
          ? new Date(tarjeta.fecha_expiracion).toISOString()
          : undefined,
        storeCard: {
          headerFields: [
            {
              key: 'saldo',
              label: progress.headerLabel,
              value: progress.headerValue,
              textAlignment: 'PKTextAlignmentRight',
            },
          ],
          primaryFields: [
            {
              key: 'cliente',
              label: 'Cliente',
              value: cliente.nombre_completo,
            },
          ],
          secondaryFields: [
            {
              key: 'slogan',
              label: comercio.slogan ? 'Programa' : 'Comercio',
              value: comercio.slogan || comercio.nombre,
              textAlignment: 'PKTextAlignmentLeft',
            },
            {
              key: 'proxima',
              label: progress.nextRewardLabel,
              value: progress.nextRewardValue,
              textAlignment: 'PKTextAlignmentRight',
            },
          ],
          auxiliaryFields: tarjeta.fecha_expiracion
            ? [
                {
                  key: 'expiracion',
                  label: 'Válido hasta',
                  value: new Date(tarjeta.fecha_expiracion).toLocaleDateString('es-PE', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  }),
                },
              ]
            : [],
          backFields,
        },
        barcodes: [
          {
            message: tarjeta.qr_value,
            format: 'PKBarcodeFormatQR',
            messageEncoding: 'iso-8859-1',
            altText: tarjeta.qr_value,
          },
        ],
      },
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

    if (comercio.logo_url) {
      const logoBuf = await fetchImageBuffer(comercio.logo_url);
      if (logoBuf) pass.addBuffer('logo.png', logoBuf);
    }
    if (comercio.hero_image_url) {
      const stripBuf = await fetchImageBuffer(comercio.hero_image_url);
      if (stripBuf) pass.addBuffer('strip.png', stripBuf);
    }

    return await pass.getAsBuffer();

  } catch (error) {
    console.error('Error generando Apple Pass:', error);
    throw new Error('No se pudo generar el archivo .pkpass. Asegúrate de tener los certificados PEM instalados y configurados.');
  }
};

module.exports = { generateApplePassBuffer };
