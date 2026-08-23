import app from './app';
import { startConnection } from './config/database';

async function main() {
    await startConnection();

    await app.listen(app.get('port'));
    console.log('Hubs service on PORT ', app.get('port'));
}

main();
