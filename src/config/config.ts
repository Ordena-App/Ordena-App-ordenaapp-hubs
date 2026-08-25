import { config } from "dotenv";

config();

export const PORT = process.env.PORT || 3013;
export const DB_LINK = process.env.DB_LINK || 'mongodb://localhost:27017/ordena_app_nosql_db';
export const JWT_SECRET = process.env.JWT_SECRET || 'hubs-service-secret';

export const BUSINESS_SERVICE_LINK = process.env.BUSINESS_SERVICE_LINK || 'http://localhost:3002/api';
export const ORDERS_SERVICE_LINK = process.env.ORDERS_SERVICE_LINK || 'http://localhost:3005/api';
export const PRODUCTS_SERVICE_LINK = process.env.PRODUCTS_SERVICE_LINK || 'http://localhost:3004/api';
export const PAYMENTS_SERVICE_LINK = process.env.PAYMENTS_SERVICE_LINK || 'http://localhost:3006/api';

// Secreto compartido para llamadas server-to-server (header x-ordena-secret).
// Se acepta INTERNAL_HUBS_SECRET (nombre canónico, igual que en los receptores
// business/orders/products) y también INTERNAL_SHARED_SECRET por compatibilidad
// con despliegues previos. El valor DEBE coincidir en los 4 servicios.
export const INTERNAL_SHARED_SECRET =
    process.env.INTERNAL_HUBS_SECRET || process.env.INTERNAL_SHARED_SECRET || '';

if (!INTERNAL_SHARED_SECRET) {
    console.warn(
        '[hubs] INTERNAL_HUBS_SECRET no configurado: las llamadas internas a ' +
        'business/orders/products serán rechazadas por los receptores (fail-closed).'
    );
}
