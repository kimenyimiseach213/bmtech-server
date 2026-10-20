# ENGINE01 category deletion — 18 October 2026

Render logs at 00:10:01 GMT+2 show `prisma.category.delete()` failed with a
PostgreSQL RESTRICT violation (SQLSTATE 23001) on `Product_categoryId_fkey`.
The Neon Prisma adapter wrapped it as `PrismaClientUnknownRequestError`.
A read-only database lookup confirmed ENGINE01 still has **one product**.

The schema intentionally restricts deletion of categories referenced by products.
`AdminService.remove` did not catch the error, so Nest returned 500. The existing
error translator only recognized Prisma P2003, not this adapter error shape.

Local changes in `src/admin/admin.service.ts`:

- Return 409 with "This category contains products. Move them to another
  category before deleting it." before attempting deletion of an occupied category.
- Translate P2003 and Neon-wrapped SQLSTATE 23001/23503 to a safe 409; return 404
  for missing records. Unrelated database errors remain server errors.
- Keep deletion and audit insertion in one transaction, preventing an audit
  failure from reporting failure after the record has already been deleted.
- Preserve database restrictions, product/image relations, and authentication.

Validation: backend production build passed and all nine offline regression tests
passed (`node --test scripts/test-admin-delete.cjs`, after building). Tests use
in-memory doubles and do not delete database records. The database inspection
was read-only; no category, product, or image was changed.

This fix is local and is **not deployed**. Production requires approval to publish
the reviewed backend change to the separate `bmtech-server` repository and let
Render deploy it. No frontend deployment or database migration is needed.

To delete ENGINE01 without losing its product, move that product to another
category first, then delete the empty category. Neither operation was performed
as part of this investigation.
