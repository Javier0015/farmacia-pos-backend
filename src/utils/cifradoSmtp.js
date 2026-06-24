import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

const ALGORITMO = 'aes-256-gcm';

const obtenerLlaveCifrado = () => {
  const llaveBase64 = String(
    process.env.SMTP_ENCRYPTION_KEY || ''
  ).trim();

  if (!llaveBase64) {
    throw new Error(
      'Falta SMTP_ENCRYPTION_KEY en las variables de entorno.'
    );
  }

  const llave = Buffer.from(llaveBase64, 'base64');

  if (llave.length !== 32) {
    throw new Error(
      'SMTP_ENCRYPTION_KEY debe ser una llave Base64 válida de 32 bytes.'
    );
  }

  return llave;
};

export const cifrarPasswordSmtp = (passwordPlano) => {
  const password = String(passwordPlano || '');

  if (!password) {
    throw new Error('La contraseña SMTP es obligatoria.');
  }

  const llave = obtenerLlaveCifrado();
  const iv = randomBytes(12);

  const cipher = createCipheriv(ALGORITMO, llave, iv);

  const contenidoCifrado = Buffer.concat([
    cipher.update(password, 'utf8'),
    cipher.final(),
  ]);

  const tagAutenticacion = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    tagAutenticacion.toString('base64'),
    contenidoCifrado.toString('base64'),
  ].join('.');
};

export const descifrarPasswordSmtp = (valorCifrado) => {
  const valor = String(valorCifrado || '').trim();
  const partes = valor.split('.');

  if (partes.length !== 3) {
    throw new Error('La contraseña SMTP cifrada tiene un formato inválido.');
  }

  const [ivBase64, tagBase64, contenidoBase64] = partes;

  const llave = obtenerLlaveCifrado();
  const iv = Buffer.from(ivBase64, 'base64');
  const tagAutenticacion = Buffer.from(tagBase64, 'base64');
  const contenidoCifrado = Buffer.from(contenidoBase64, 'base64');

  const decipher = createDecipheriv(ALGORITMO, llave, iv);
  decipher.setAuthTag(tagAutenticacion);

  const passwordPlano = Buffer.concat([
    decipher.update(contenidoCifrado),
    decipher.final(),
  ]);

  return passwordPlano.toString('utf8');
};