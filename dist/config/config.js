"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INTERNAL_SHARED_SECRET = exports.PAYMENTS_SERVICE_LINK = exports.PRODUCTS_SERVICE_LINK = exports.ORDERS_SERVICE_LINK = exports.BUSINESS_SERVICE_LINK = exports.JWT_SECRET = exports.DB_LINK = exports.PORT = void 0;
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
exports.PORT = process.env.PORT || 3013;
exports.DB_LINK = process.env.DB_LINK || 'mongodb://localhost:27017/ordena_app_nosql_db';
exports.JWT_SECRET = process.env.JWT_SECRET || 'hubs-service-secret';
exports.BUSINESS_SERVICE_LINK = process.env.BUSINESS_SERVICE_LINK || 'http://localhost:3002/api';
exports.ORDERS_SERVICE_LINK = process.env.ORDERS_SERVICE_LINK || 'http://localhost:3005/api';
exports.PRODUCTS_SERVICE_LINK = process.env.PRODUCTS_SERVICE_LINK || 'http://localhost:3004/api';
exports.PAYMENTS_SERVICE_LINK = process.env.PAYMENTS_SERVICE_LINK || 'http://localhost:3006/api';
// Secreto compartido para llamadas server-to-server (header x-ordena-secret).
// Se acepta INTERNAL_HUBS_SECRET (nombre canónico, igual que en los receptores
// business/orders/products) y también INTERNAL_SHARED_SECRET por compatibilidad
// con despliegues previos. El valor DEBE coincidir en los 4 servicios.
exports.INTERNAL_SHARED_SECRET = process.env.INTERNAL_HUBS_SECRET || process.env.INTERNAL_SHARED_SECRET || '';
if (!exports.INTERNAL_SHARED_SECRET) {
    console.warn('[hubs] INTERNAL_HUBS_SECRET no configurado: las llamadas internas a ' +
        'business/orders/products serán rechazadas por los receptores (fail-closed).');
}
