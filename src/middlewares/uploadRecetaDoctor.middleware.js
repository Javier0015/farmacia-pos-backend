import multer from 'multer';
import path from 'path';
import fs from 'fs';

const uploadDir = path.join(process.cwd(), 'uploads', 'recetas_doctores');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname);

    const nombreBase = path
      .basename(file.originalname, extension)
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9-_]/g, '');

    const nombreSeguro = nombreBase || 'receta';

    const nombreArchivo = `receta-doctor-${Date.now()}-${nombreSeguro}${extension}`;

    cb(null, nombreArchivo);
  },
});

const fileFilter = (req, file, cb) => {
  const tiposPermitidos = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];

  if (tiposPermitidos.includes(file.mimetype)) {
    cb(null, true);
    return;
  }

  cb(new Error('Solo se permiten imágenes JPG, PNG, WEBP o PDF'), false);
};

export const uploadRecetaDoctor = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});