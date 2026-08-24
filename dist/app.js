"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const morgan_1 = __importDefault(require("morgan"));
const config_1 = require("./config/config");
const hubUsers_routes_1 = __importDefault(require("./routes/hubUsers.routes"));
const hubs_routes_1 = __importDefault(require("./routes/hubs.routes"));
const hubCategories_routes_1 = __importDefault(require("./routes/hubCategories.routes"));
const hubBusinesses_routes_1 = __importDefault(require("./routes/hubBusinesses.routes"));
const hubOrders_routes_1 = __importDefault(require("./routes/hubOrders.routes"));
const hubProducts_routes_1 = __importDefault(require("./routes/hubProducts.routes"));
const app = (0, express_1.default)();
app.set('port', config_1.PORT);
app.use((0, morgan_1.default)('dev'));
app.use(express_1.default.json({ limit: '20mb' }));
app.use(express_1.default.urlencoded({ limit: '20mb', extended: true }));
// Rutas de la API.
// El api-gateway expone este servicio como público bajo /api/hubs (mismo patrón
// que /api/agencies): la autenticación es el JWT propio del servicio, NO Firebase.
app.use('/api/hub-users', hubUsers_routes_1.default);
app.use('/api/hubs', hubOrders_routes_1.default);
app.use('/api/hubs', hubProducts_routes_1.default);
app.use('/api/hubs', hubBusinesses_routes_1.default);
app.use('/api/hubs', hubCategories_routes_1.default);
app.use('/api/hubs', hubs_routes_1.default);
app.use('', (req, res, next) => {
    res.status(404).json({ message: 'Endpoint not found' });
    next();
});
exports.default = app;
