import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export const PG_POOL = Symbol("PG_POOL");
export const DRIZZLE = Symbol("DRIZZLE");
export const DB_CONNECTION_TIMEOUT_MS = 5000;
export type Database = NodePgDatabase<typeof schema>;

@Injectable()
class PoolLifecycle implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({})
export class DatabaseModule {
  static forRoot(databaseUrl: string): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: PG_POOL,
          useFactory: () => {
            const pool = new pg.Pool({
              connectionString: databaseUrl,
              connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
            });
            // Without a listener an idle-connection error (e.g. Postgres restart) would crash the process.
            pool.on("error", (error) => {
              new Logger("Database").error(
                `Idle database client error: ${error.message}`,
                error.stack,
              );
            });
            return pool;
          },
        },
        {
          provide: DRIZZLE,
          inject: [PG_POOL],
          useFactory: (pool: pg.Pool): Database => drizzle(pool, { schema }),
        },
        PoolLifecycle,
      ],
      exports: [PG_POOL, DRIZZLE],
    };
  }
}
