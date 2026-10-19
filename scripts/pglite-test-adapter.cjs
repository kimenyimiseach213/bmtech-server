// Test-only Prisma driver over in-memory PostgreSQL. No sockets or Neon URLs.
const { PGlite } = require('@electric-sql/pglite');
const { DriverAdapterError } = require('@prisma/driver-adapter-utils');
const fs = require('node:fs');
const path = require('node:path');

async function database() {
  // Prisma interprets TIMESTAMP WITHOUT TIME ZONE as UTC. PGlite's default
  // parser uses the host timezone, which differs on this Windows workstation.
  const db = new PGlite({ parsers: { 1114: value => new Date(value.replace(' ', 'T') + 'Z') } });
  const migrations = path.resolve(__dirname, '../prisma/migrations');
  for (const name of fs.readdirSync(migrations).sort()) {
    const file = path.join(migrations, name, 'migration.sql');
    if (fs.existsSync(file)) await db.exec(fs.readFileSync(file, 'utf8'));
  }
  let tail = Promise.resolve();
  async function acquire() {
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    return release;
  }
  async function locked(callback) { const release = await acquire(); try { return await callback(); } finally { release(); } }
  const types = { 16: 5, 20: 1, 21: 0, 23: 0, 25: 7, 1043: 7, 1114: 10, 1184: 10, 114: 11, 3802: 11, 700: 2, 701: 3, 1700: 4, 2950: 15 };
  async function run(query) {
    try { return await db.query(query.sql, query.args); }
    catch (error) {
      if (error.code === '23505') throw new DriverAdapterError({ kind: 'UniqueConstraintViolation', constraint: { index: error.constraint } });
      if (['23503', '23001'].includes(error.code)) throw new DriverAdapterError({ kind: 'ForeignKeyConstraintViolation', constraint: { index: error.constraint } });
      throw error;
    }
  }
  async function queryRaw(query) {
    const result = await run(query);
    return { columnNames: result.fields.map(field => field.name), columnTypes: result.fields.map(field => types[field.dataTypeID] ?? 7),
      rows: result.rows.map(row => result.fields.map(field => {
        const value = row[field.name];
        if (value == null) return null;
        if (value instanceof Date) return value.toISOString();
        if ([114, 3802].includes(field.dataTypeID)) return JSON.stringify(value);
        if ([20, 1700].includes(field.dataTypeID)) return String(value);
        return value;
      })) };
  }
  const executeRaw = async query => (await run(query)).affectedRows || 0;
  const info = { provider: 'postgres', adapterName: 'test-only-pglite' };
  const adapter = { ...info, connect: async () => ({
    ...info,
    queryRaw: query => locked(() => queryRaw(query)), executeRaw: query => locked(() => executeRaw(query)),
    executeScript: script => locked(() => db.exec(script)),
    getConnectionInfo: () => ({ schemaName: 'public', supportsRelationJoins: false }),
    dispose: async () => {},
    startTransaction: async () => {
      const release = await acquire();
      await db.exec('BEGIN');
      return { ...info, options: { usePhantomQuery: true }, queryRaw, executeRaw,
        commit: async () => { try { await db.exec('COMMIT'); } finally { release(); } },
        rollback: async () => { try { await db.exec('ROLLBACK'); } finally { release(); } },
      };
    },
  }) };
  return { db, adapter };
}
module.exports = { database };
