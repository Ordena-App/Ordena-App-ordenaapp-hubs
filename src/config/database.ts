import { connect } from 'mongoose';
import { DB_LINK } from './config';

// Inicia la conexión con la base de datos compartida de la plataforma
export async function startConnection() {
    try {
        await connect(DB_LINK);
        console.log('Database connected');
    } catch (error) {
        console.log(error);
    }
}
