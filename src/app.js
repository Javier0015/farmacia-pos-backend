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
app.use(express.json());
app.use(morgan('dev'));

// Archivos públicos subidos
// Ruta física: backend/uploads
// URL pública: http://localhost:3001/uploads/...
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Ruta inicial
app.get('/', (req, res) => {
  res.json({
    ok: true,
    mensaje: 'API Farmacia POS funcionando correctamente',
  });
});

// Ruta de prueba
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    mensaje: 'Backend activo',
    fecha: new Date(),
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



export default app;