// Run after npm run build. Uses in-memory doubles; never connects to a database.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Prisma } = require('@prisma/client');
const { AdminService } = require('../dist/admin/admin.service');

function fixture({ productCount = 0, deleteError, auditError } = {}) {
  const calls = [];
  let committed = false;
  const remove = (model) => async (args) => {
    calls.push([model, args]);
    if (deleteError) throw deleteError;
    return { id: args.where.id };
  };
  const tx = {
    product: { count: async (args) => { calls.push(['count', args]); return productCount; }, delete: remove('product') },
    category: { delete: remove('category') },
    review: { delete: remove('review') },
    auditLog: { create: async (args) => { calls.push(['audit', args]); if (auditError) throw auditError; return {}; } },
  };
  const prisma = { $transaction: async (callback) => {
    calls.push(['transaction']);
    const result = await callback(tx);
    committed = true;
    return result;
  } };
  return { service: new AdminService(prisma, {}), calls, committed: () => committed };
}
const known = (code) => new Prisma.PrismaClientKnownRequestError('Test database failure', { code, clientVersion: '6.19.3' });
const unknown = (code) => new Prisma.PrismaClientUnknownRequestError(
  `ConnectorError(QueryError(PostgresError { code: "${code}", message: "constraint failure" }))`,
  { clientVersion: '6.19.3' },
);

test('category containing products returns actionable 409 without deleting or auditing', async () => {
  const f = fixture({ productCount: 2 });
  await assert.rejects(f.service.remove('categories', 'category-id', 'admin-id'), error => {
    assert.equal(error.getStatus(), 409);
    assert.match(error.message, /Move them to another category/);
    return true;
  });
  assert.deepEqual(f.calls, [['transaction'], ['count', { where: { categoryId: 'category-id' } }]]);
  assert.equal(f.committed(), false);
});

test('empty category deletion and audit use the same transaction', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.remove('categories', 'category-id', 'admin-id'), { ok: true, id: 'category-id' });
  assert.deepEqual(f.calls.map(call => call[0]), ['transaction', 'count', 'category', 'audit']);
  assert.deepEqual(f.calls[3][1].data, { adminId: 'admin-id', action: 'DELETE', entity: 'Category', entityId: 'category-id', details: {} });
  assert.equal(f.committed(), true);
});

test('product and review deletion keep their existing delegates and audit entities', async () => {
  for (const [resource, model, entity] of [['products', 'product', 'Product'], ['reviews', 'review', 'Review']]) {
    const f = fixture();
    assert.deepEqual(await f.service.remove(resource, 'record-id', 'admin-id'), { ok: true, id: 'record-id' });
    assert.deepEqual(f.calls.map(call => call[0]), ['transaction', model, 'audit']);
    assert.equal(f.calls[2][1].data.entity, entity);
  }
});

test('known Prisma foreign-key failure returns 409, including a concurrent new dependency', async () => {
  const f = fixture({ deleteError: known('P2003') });
  await assert.rejects(f.service.remove('categories', 'category-id', 'admin-id'), error => error.getStatus() === 409);
  assert.equal(f.committed(), false);
  assert.equal(f.calls.some(call => call[0] === 'audit'), false);
});

test('Neon wrapped PostgreSQL RESTRICT and foreign-key errors return 409', async () => {
  for (const code of ['23001', '23503']) {
    const f = fixture({ deleteError: unknown(code) });
    await assert.rejects(f.service.remove('categories', 'category-id', 'admin-id'), error => error.getStatus() === 409);
    assert.equal(f.committed(), false);
  }
});

test('missing records return 404 for each supported resource', async () => {
  for (const resource of ['categories', 'products', 'reviews']) {
    const f = fixture({ deleteError: known('P2025') });
    await assert.rejects(f.service.remove(resource, 'missing-id', 'admin-id'), error => error.getStatus() === 404);
    assert.equal(f.committed(), false);
  }
});

test('audit failure rejects the transaction instead of committing the deletion', async () => {
  const error = new Error('audit unavailable');
  const f = fixture({ auditError: error });
  await assert.rejects(f.service.remove('products', 'product-id', 'admin-id'), value => value === error);
  assert.equal(f.committed(), false);
});

test('unrelated database failures remain server errors', async () => {
  const error = unknown('08006');
  const f = fixture({ deleteError: error });
  await assert.rejects(f.service.remove('products', 'product-id', 'admin-id'), value => value === error);
});

test('unsupported resources cannot select a deletion delegate', async () => {
  for (const resource of ['orders', 'toString', '__proto__']) {
    const f = fixture();
    await assert.rejects(f.service.remove(resource, 'record-id', 'admin-id'), error => error.getStatus() === 400);
    assert.deepEqual(f.calls, []);
  }
});
