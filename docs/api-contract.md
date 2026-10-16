# BMTECH API contract

The Next.js frontend calls the NestJS API through the same-origin route `/api/backend/*`. Set the frontend server variable `BMTECH_API_BASE_URL` to the API origin such as `http://localhost:3001`; do not append `/api/v1`.

The implementation is in `backend/`. Its PostgreSQL/Prisma schema and local startup instructions are in `backend/prisma/schema.prisma` and `backend/README.md`.

## Public storefront

| Method | API path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/products?status=published` | Published products in active categories, with bilingual data and images |
| GET | `/api/v1/products/:slug` | Published product details |
| GET | `/api/v1/categories?status=active` | Active product categories |
| GET | `/api/v1/settings/public` | Public BMTECH contact details, hours, and bilingual company profile |
| POST | `/api/v1/orders` | Guest order; accepts customer, fulfillment, item slugs and quantities, locale, and an idempotency `clientReference` |
| POST | `/api/v1/quotation-requests` | Save a quotation request with `OPEN` status |
| POST | `/api/v1/technician-bookings` | Save a technician booking with `PENDING` status |
| POST | `/api/v1/contact-messages` | Save a contact message with `UNREAD` status |
| POST | `/api/v1/reviews` | Save a review with `PENDING` moderation status |

Order totals are recalculated from current database prices; posted prices are never accepted. The API saves line snapshots and creates the order, payment record, and stock deductions in a database transaction. The response includes `order.reference`, `order.total`, saved items, and `whatsappConfirmationUrl`.

## Administrator

`POST /api/v1/admin/auth/login` accepts `{ email, password }` and returns a short-lived bearer token backed by a database session. The frontend API proxy stores it in an HttpOnly cookie. `POST /api/v1/admin/auth/logout` revokes the active session before the proxy clears the cookies. Every `/api/v1/admin/*` data route validates both the bearer token and its active database session.

Create the first admin through `POST /api/v1/admin/auth/bootstrap` with header `x-admin-bootstrap-token` and `{ email, name, password }`. It only works when the configured one-time token is set and there are no admin records. It is not a signup route; remove the token from the environment after bootstrap.

The dashboard summary returns `pendingOrders`, `unverifiedPayments`, `openQuotations`, `pendingBookings`, and `unreadMessages`.

Admin resources are under `/api/v1/admin/`: `products`, `categories`, `orders`, `payments`, `quotation-requests`, `technician-bookings`, `contact-messages`, `reviews`, and `settings`. Product/category records support create, update, and deletion. The customer request resources support review/status updates; review deletion is supported. Company settings use GET/PATCH `/admin/settings`.

Product images use POST `/admin/products/:id/images` with multipart field `files`, DELETE `/admin/products/:id/images/:imageId`, and PATCH `/admin/products/:id/images/reorder` with `{ imageIds, coverImageId }`. Category ordering uses PATCH `/admin/categories/:id/reorder` with `{ sortOrder }`. Payment verification uses POST `/admin/orders/:orderId/payment/verify` or POST `/admin/payments/:paymentId/verify`; both update payment and order state and create an audit record in the same transaction.

The frontend may continue to show its preview catalogue if the API is unreachable, but public form submissions and admin writes only display success when the server responds successfully.
