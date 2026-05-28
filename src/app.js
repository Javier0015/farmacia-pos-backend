import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';

import sucursalesRoutes from './routes/sucursales.routes.js';
import categoriasRoutes from './routes/categorias.routes.js';
import productosRoutes from './routes/productos.routes.js';
import inventarioRoutes from './routes/inventario.routes.js';
import cajaRoutes from './routes/caja.routes.js';
import ventasRoutes from './routes/ventas.routes.js';
import proveedoresRoutes from './routes/proveedores.routes.js';
import comprasRoutes from './routes/compras.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import usuariosRoutes from './routes/usuarios.routes.js';
import cajasAdminRoutes from './routes/cajas.admin.routes.js';
import tarjetasPuntosRoutes from './routes/tarjetasPuntos.routes.js';
import authRoutes from './routes/auth.routes.js';
import alertasRoutes from './routes/alertas.routes.js';
import chatRoutes from './routes/chat.routes.js';
import configuracionPuntosRoutes from './routes/configuracionPuntos.routes.js';
import doctoresRoutes from './routes/doctores.routes.js';
import recetasDoctorRoutes from './routes/recetasDoctor.routes.js';
import ofertasCategoriasRoutes from './routes/ofertasCategorias.routes.js';
import catalogoRoutes from './routes/catalogo.routes.js';
import catalogoPublicoRoutes from './routes/catalogoPublico.routes.js';
import doctorShaddaiRoutes from './routes/doctorShaddai.routes.js';
import doctorFilaRoutes from './routes/doctorFila.routes.js';
import laboratorioRoutes from './routes/laboratorio.routes.js';
import notasMedicasRoutes from './routes/notasMedicas.routes.js';
import referenciasRoutes from './routes/referencias.routes.js';
import violenciaLesionRoutes from './routes/violenciaLesion.routes.js';
import consentimientosRoutes from './routes/consentimientos.routes.js';
import documentosClinicosRoutes from './routes/documentosClinicos.routes.js';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middlewares
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(morgan('dev'));

// Archivos públicos subidos
// Ruta física: backend/uploads
// URL pública: https://tu-backend.onrender.com/uploads/...
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Ruta inicial
app.get('/', (req, res) => {
  res.json({
    ok: true,
    mensaje: 'API Farmacia POS funcionando correctamente',
    fecha: new Date(),
  });
});

// Ruta de prueba general
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    mensaje: 'Backend activo',
    fecha: new Date(),
  });
});

// Ruta temporal para revisar si Render ya tomó el deploy correcto
app.get('/api/debug-rutas', (req, res) => {
  res.json({
    ok: true,
    mensaje: 'Debug de rutas activo',
    backend: 'farmacia-pos-backend',
    fecha: new Date(),
    rutas_importantes: {
      health: '/api/health',
      auth: '/api/auth',
      sucursales: '/api/sucursales',
      productos: '/api/productos',
      inventario: '/api/inventario',
      caja: '/api/caja',
      ventas: '/api/ventas',
      doctor_shaddai: {
        base: '/api/doctor-shaddai',
        mi_perfil: '/api/doctor-shaddai/mi-perfil',
        expedientes: '/api/doctor-shaddai/expedientes',
        recetas: '/api/doctor-shaddai/recetas',
        receta_por_id: '/api/doctor-shaddai/recetas/:id',
        cancelar_receta: '/api/doctor-shaddai/recetas/:id/cancelar',
        surtir_receta: '/api/doctor-shaddai/recetas/:id/surtir',
        nota_medica: '/api/doctor-shaddai/notas-medicas/:idNota',
      },
      doctor_fila: '/api/doctor-fila',
      laboratorio: '/api/laboratorio',
      notas_medicas: '/api/notas-medicas',
      referencias: '/api/referencias',
      violencia_lesion: '/api/violencia-lesion',
      consentimientos: '/api/consentimientos',
      documentos_clinicos: '/api/documentos-clinicos',
    },
  });
});

// Rutas principales
app.use('/api/auth', authRoutes);
app.use('/api/sucursales', sucursalesRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/caja', cajaRoutes);
app.use('/api/ventas', ventasRoutes);
app.use('/api/proveedores', proveedoresRoutes);
app.use('/api/compras', comprasRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/admin/cajas', cajasAdminRoutes);
app.use('/api/tarjetas-puntos', tarjetasPuntosRoutes);
app.use('/api/alertas', alertasRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/configuracion-puntos', configuracionPuntosRoutes);
app.use('/api/doctores', doctoresRoutes);
app.use('/api/recetas-doctor', recetasDoctorRoutes);
app.use('/api/ofertas-categorias', ofertasCategoriasRoutes);
app.use('/api/catalogo', catalogoRoutes);
app.use('/api/public/catalogo', catalogoPublicoRoutes);
app.use('/api/doctor-shaddai', doctorShaddaiRoutes);
app.use('/api/doctor-fila', doctorFilaRoutes);
app.use('/api/laboratorio', laboratorioRoutes);
app.use('/api/notas-medicas', notasMedicasRoutes);
app.use('/api/referencias', referenciasRoutes);
app.use('/api/violencia-lesion', violenciaLesionRoutes);
app.use('/api/consentimientos', consentimientosRoutes);
app.use('/api/documentos-clinicos', documentosClinicosRoutes);

// Middleware para rutas no encontradas
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    mensaje: 'Ruta no encontrada',
    metodo: req.method,
    ruta_solicitada: req.originalUrl,
    sugerencia: 'Revisa que el endpoint exista y que Render esté usando el último deploy.',
  });
});

// Middleware general de errores
app.use((err, req, res, next) => {
  console.error('Error general del servidor:', err);

  res.status(err.status || 500).json({
    ok: false,
    mensaje: 'Error interno del servidor',
    error: process.env.NODE_ENV === 'production' ? undefined : err.message,
  });
});

export default app;