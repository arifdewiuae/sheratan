# The API, for the app you are building

One server, already running. Everything below is stable for the whole task.
There is no authentication step: the session already exists.

Base URL: the origin this page is served from.

## Resources

### `GET /api/customers`

Every customer, in a fixed order. `?q=<text>` filters on name and company,
case-insensitively; an empty `q` is the same as no `q`.

```json
[{ "id": 1, "name": "Customer 1", "company": "Company 1", "country": "Netherlands" }]
```

### `GET /api/orders`

```json
[{ "id": 101, "customer": "Customer 1", "status": "pending" }]
```

`status` is one of `pending`, `packing`, `shipped`.

### `POST /api/orders`

Body:

```json
{ "customerId": 1, "quantity": 5, "note": "optional, 200 characters at most" }
```

`200` with `{ "id": 900 }` on success. `422` with field errors if the server
refuses it:

```json
{ "errors": { "quantity": "Quantity must be a whole number between 1 and 1000." } }
```

The keys are field names: `customer`, `quantity`, `note`.

### `PATCH /api/orders/:id`

Body `{ "status": "shipped" }`. `200` with the updated order, `404` if there is
no such order. The change persists, so a later `GET /api/orders` shows it.

### `GET /api/session`

```json
{ "user": "Ada Bakker", "company": "Company 1" }
```

`401` with `{ "error": "session expired" }` once the session has ended. Every
other route answers `401` from that point too.

### `GET /api/instruments`

```json
[{ "symbol": "ACME", "name": "Acme Industries", "open": 100 }]
```

## Live prices

`WS /ws/prices`. No subprotocol, no handshake message — messages start
arriving on connect. Each is JSON:

```json
{ "type": "price", "symbol": "ACME", "price": 99.66, "ts": 1 }
```

`ts` is a tick counter, not a clock reading. One other message can arrive:

```json
{ "type": "session_expired" }
```

## Errors

Every failure other than a `422` uses one shape:

```json
{ "error": "some message" }
```

Statuses you may see: `400`, `401`, `404`, `409`, `422`, `500`. Any route may
be slow, and any route may fail — the server is deliberately unreliable, and
handling that is part of the task.
