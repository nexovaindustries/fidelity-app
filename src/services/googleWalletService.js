const jwt = require('jsonwebtoken');
const fs = require('fs');
const env = require('../config/env');

/** Calcula progreso y etiquetas por tipo de fidelización */
function getProgressInfo(tarjeta, comercio) {
  const tipo = comercio.tipo_fidelizacion || 'puntos';
  const config = comercio.config_fidelizacion || {};

  if (tipo === 'sellos') {
    const meta = config.meta_sellos || 10;
    const current = tarjeta.total_sellos || 0;
    const faltan = Math.max(0, meta - current);
    return {
      mainHeader: 'Sellos',
      mainBody: `${current} de ${meta}`,
      statusHeader: faltan === 0 ? '¡Premio disponible!' : 'Faltan',
      statusBody: faltan === 0 ? 'Muéstralo al cajero' : `${faltan} sello${faltan !== 1 ? 's' : ''}`,
      rewardDescription: config.descripcion_recompensa || `Completa ${meta} sellos y gana tu premio`,
    };
  }

  if (tipo === 'niveles') {
    const current = tarjeta.puntos_actuales || 0;
    const nivel = tarjeta.nivel_actual || 'Bronce';
    let nextLabel, nextBody;
    if (current < 500) { nextLabel = 'Para Plata'; nextBody = `${500 - current} pts`; }
    else if (current < 1000) { nextLabel = 'Para Oro'; nextBody = `${1000 - current} pts`; }
    else { nextLabel = 'Nivel Máximo'; nextBody = '¡Felicitaciones!'; }
    return {
      mainHeader: 'Nivel Actual',
      mainBody: nivel,
      statusHeader: nextLabel,
      statusBody: nextBody,
      rewardDescription: config.descripcion_recompensa || 'Disfruta los beneficios exclusivos de tu membresía',
    };
  }

  // puntos (default)
  const meta = config.puntos_para_recompensa || 100;
  const current = tarjeta.puntos_actuales || 0;
  const ciclo = current % meta;
  const faltan = ciclo === 0 && current > 0 ? 0 : meta - ciclo;
  return {
    mainHeader: 'Puntos',
    mainBody: String(current),
    statusHeader: faltan === 0 ? '¡Canjea ahora!' : 'Próxima recompensa',
    statusBody: faltan === 0 ? 'Premio disponible' : `en ${faltan} pts`,
    rewardDescription: config.descripcion_recompensa || `Acumula ${meta} puntos y canjea tu recompensa`,
  };
}

/**
 * Genera la URL de "Añadir a Google Wallet" para una tarjeta instalable
 * @param {object} tarjeta - Registro de la base de datos (con comercios y clientes)
 * @returns {string} url - El link seguro `https://pay.google.com/gp/v/save/${jwt}`
 */
const generateGooglePassUrl = (tarjeta) => {
  const comercio = tarjeta.comercios;
  const cliente = tarjeta.clientes;
  let credentials;

  try {
    if (fs.existsSync(env.google.credentialsPath)) {
      credentials = JSON.parse(fs.readFileSync(env.google.credentialsPath, 'utf8'));
    } else {
      throw new Error(`Credenciales JSON no encontradas en ruta: ${env.google.credentialsPath}`);
    }
  } catch (error) {
    console.error('Error cargando credenciales Google Service Account:', error);
    throw new Error('La integración de Google Wallet requiere de un archivo de Service Account válido.');
  }

  const objectId = `${env.google.issuerId}.${tarjeta.id.replace(/-/g, '')}`;
  const progress = getProgressInfo(tarjeta, comercio);

  // Links de contacto (website, teléfono)
  const uris = [];
  if (comercio.sitio_web) {
    uris.push({ uri: comercio.sitio_web, description: 'Visitar Sitio Web', id: 'web' });
  }
  if (comercio.telefono) {
    uris.push({ uri: `tel:${comercio.telefono}`, description: 'Llamar al negocio', id: 'tel' });
  }

  // Módulos de texto con info de progreso y contacto
  const textModulesData = [
    {
      id: 'saldo',
      header: progress.mainHeader,
      body: progress.mainBody,
    },
    {
      id: 'prox_recompensa',
      header: progress.statusHeader,
      body: progress.statusBody,
    },
    {
      id: 'descripcion',
      header: 'Cómo ganar tu recompensa',
      body: progress.rewardDescription,
    },
  ];

  if (comercio.slogan) {
    textModulesData.push({
      id: 'slogan',
      header: 'Programa',
      body: comercio.slogan,
    });
  }

  const payloadObject = {
    id: objectId,
    classId: env.google.classId,
    genericType: 'GENERIC_TYPE_UNSPECIFIED',
    hexBackgroundColor: comercio.color_fondo || '#1a1a2e',
    logo: comercio.logo_url
      ? { sourceUri: { uri: comercio.logo_url } }
      : undefined,
    heroImage: comercio.hero_image_url
      ? { sourceUri: { uri: comercio.hero_image_url } }
      : undefined,
    cardTitle: {
      defaultValue: { language: 'es-ES', value: comercio.nombre },
    },
    subheader: {
      defaultValue: { language: 'es-ES', value: 'Cliente' },
    },
    header: {
      defaultValue: { language: 'es-ES', value: cliente.nombre_completo },
    },
    barcode: {
      type: 'QR_CODE',
      value: tarjeta.qr_value,
      alternateText: tarjeta.qr_value,
    },
    textModulesData,
    linksModuleData: uris.length > 0 ? { uris } : undefined,
    validTimeInterval: tarjeta.fecha_expiracion
      ? { end: { date: new Date(tarjeta.fecha_expiracion).toISOString() } }
      : undefined,
  };

  // Limpiar campos undefined
  Object.keys(payloadObject).forEach(
    (key) => payloadObject[key] === undefined && delete payloadObject[key]
  );

  const payload = {
    iss: credentials.client_email,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: [],
    payload: {
      genericObjects: [payloadObject],
    },
  };

  const token = jwt.sign(payload, credentials.private_key, { algorithm: 'RS256' });

  return `https://pay.google.com/gp/v/save/${token}`;
};

module.exports = { generateGooglePassUrl };
