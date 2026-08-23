import { config } from "dotenv";

config();

export const PORT = process.env.PORT || 3013;
export const DB_LINK = process.env.DB_LINK || 'mongodb://localhost:27017/ordena_app_nosql_db';
export const JWT_SECRET = process.env.JWT_SECRET || 'hubs-service-secret';

export const BUSINESS_SERVICE_LINK = process.env.BUSINESS_SERVICE_LINK || 'http://localhost:3002/api';
export const ORDERS_SERVICE_LINK = process.env.ORDERS_SERVICE_LINK || 'http://localhost:3005/api';
export const PRODUCTS_SERVICE_LINK = process.env.PRODUCTS_SERVICE_LINK || 'http://localhost:3004/api';

// Secreto compartido para llamadas server-to-server (mismo patrón que
// whatsapp-bot / shipping: el receptor valida el header x-ordena-secret).
export const INTERNAL_SHARED_SECRET = process.env.INTERNAL_SHARED_SECRET || '';
