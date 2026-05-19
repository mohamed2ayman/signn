import { DataSource, DataSourceOptions } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

// data-source.ts runs OUTSIDE the NestJS bootstrap (typeorm CLI, migrations).
// Joi validation in app.module.ts does NOT protect this path, so we validate
// DATABASE_URL manually here with a clear error.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    `\n` +
      `╔════════════════════════════════════════════════════╗\n` +
      `║          DATABASE CONFIGURATION ERROR              ║\n` +
      `╠════════════════════════════════════════════════════╣\n` +
      `║  DATABASE_URL is required but not set.             ║\n` +
      `║                                                    ║\n` +
      `║  Add to your .env file:                            ║\n` +
      `║  DATABASE_URL=postgresql://user:pass@host:5432/db  ║\n` +
      `║                                                    ║\n` +
      `║  For local dev, use docker-compose values:         ║\n` +
      `║  DATABASE_URL=postgresql://sign_user:sign_password ║\n` +
      `║  @localhost:5432/sign_db                           ║\n` +
      `╚════════════════════════════════════════════════════╝`,
  );
}

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: databaseUrl,
  entities: [__dirname + '/../database/entities/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
