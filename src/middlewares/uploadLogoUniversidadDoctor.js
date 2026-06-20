import fs from 'fs';
import path from 'path';
import multer from 'multer';

const uploadDir = path.resolve(
  process.cwd(),
  'uploads',
  'doctor-shaddai',
  'logos-universidad'
);

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {
    const idUsuario =
      req.usuario?.id_usuario ||
      req.usuario?.id ||
      req.user?.id_usuario ||
      req.user?.id ||
      'doctor';

    const ext = path.extname(file.originalname).toLowerCase();

    cb(null, `logo-universidad-${idUsuario}-${Date.now()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const permitidos = ['image/jpeg', 'image/png', 'image/webp'];

  if (!permitidos.includes(file.mimetype)) {
    return cb(new Error('Solo se permiten imágenes JPG, PNG o WEBP.'));
  }

  cb(null, true);
};

export const uploadLogoUniversidadDoctor = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
});