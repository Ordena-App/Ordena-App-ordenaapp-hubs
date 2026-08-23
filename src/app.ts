import express from 'express';
import morgan from 'morgan';

import { PORT } from './config/config';
import hubUsersRoutes from './routes/hubUsers.routes';
import hubsRoutes from './routes/hubs.routes';
import hubCategoriesRoutes from './routes/hubCategories.routes';
import hubBusinessesRoutes from './routes/hubBusinesses.routes';
import hubOrdersRoutes from './routes/hubOrders.routes';

const app = express();

app.set('port', PORT);

app.use(morgan('dev'));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// Rutas de la API.
// El api-gateway expone este servicio como público bajo /api/hubs (mismo patrón
// que /api/agencies): la autenticación es el JWT propio del servicio, NO Firebase.
app.use('/api/hub-users', hubUsersRoutes);
app.use('/api/hubs', hubOrdersRoutes);
app.use('/api/hubs', hubBusinessesRoutes);
app.use('/api/hubs', hubCategoriesRoutes);
app.use('/api/hubs', hubsRoutes);

app.use('', (req, res, next) => {
    res.status(404).json({ message: 'Endpoint not found' });
    next();
});

export default app;
