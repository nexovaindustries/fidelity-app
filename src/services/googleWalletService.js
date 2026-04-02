const jwt = require('jsonwebtoken');
const fs = require('fs');
const env = require('../config/env');

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

  const tipoFidelizacion = comercio.tipo_fidelizacion || 'puntos';
  let mainHeader = '';
  let mainBody = '';

  if (tipoFidelizacion === 'puntos') {
    mainHeader = 'Puntos';
    mainBody = String(tarjeta.puntos_actuales || 0);
  } else if (tipoFidelizacion === 'sellos') {
    mainHeader = 'Sellos';
    const meta = comercio.config_fidelizacion?.meta_sellos || 10;
    mainBody = `${tarjeta.total_sellos || 0} de ${meta}`;
  } else if (tipoFidelizacion === 'niveles') {
    mainHeader = 'Nivel Actual';
    mainBody = tarjeta.nivel_actual || 'Bronce';
  }

  const payloadObject = {
    id: objectId,
    classId: env.google.classId, 
    genericType: 'GENERIC_TYPE_UNSPECIFIED',
    hexBackgroundColor: comercio.color_fondo || '#FFFFFF',
    logo: comercio.logo_url ? {
      sourceUri: { uri: comercio.logo_url }
    } : undefined,
    heroImage: comercio.hero_image_url ? {
      sourceUri: { uri: comercio.hero_image_url }
    } : undefined,
    cardTitle: {
      defaultValue: { language: 'es-ES', value: comercio.nombre }
    },
    subheader: {
      defaultValue: { language: 'es-ES', value: 'Cliente' }
    },
    header: {
      defaultValue: { language: 'es-ES', value: cliente.nombre_completo }
    },
    barcode: {
      type: 'QR_CODE',
      value: tarjeta.qr_value,
      alternateText: tarjeta.qr_value
    },
    textModulesData: [
      {
        header: mainHeader,
        body: mainBody
      },
      {
        header: 'Modelo',
        body: tipoFidelizacion.toUpperCase()
      }
    ],
    validTimeInterval: tarjeta.fecha_expiracion ? {
      end: {
        date: new Date(tarjeta.fecha_expiracion).toISOString()
      }
    } : undefined
  };

  // Limpiar undefined
  Object.keys(payloadObject).forEach(key => payloadObject[key] === undefined && delete payloadObject[key]);

  const payload = {
    iss: credentials.client_email,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: [], 
    payload: {
      genericObjects: [payloadObject]
    }
  };

  const token = jwt.sign(payload, credentials.private_key, { algorithm: 'RS256' });

  return `https://pay.google.com/gp/v/save/${token}`;
};

module.exports = {
  generateGooglePassUrl
};
