import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
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

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

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

export default app;