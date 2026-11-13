# When to mock

Mock only at **system boundaries**:

- external APIs (payments, email, third-party services);
- time and randomness;
- the database, sometimes: prefer a real test database or a local stand-in when it is fast;
- the file system, sometimes: prefer a temporary folder.

Do not mock:

- your own modules or classes;
- internal collaborators;
- anything you control.

## Which test double

Use the simplest double that does the job. More real code in a test gives more confidence.

1. **The real implementation**: highest confidence.
2. **A fake**: a working in-memory version (an in-memory store, a fake clock).
3. **A stub**: returns fixed data, has no behaviour.
4. **A mock that checks calls**: last choice. It couples the test to the implementation.

Use a double only when the real thing is slow, not deterministic, or has effects you cannot
control (it sends email, charges a card).

A double does not prove what only the real boundary does. An injected exception is not a crashed
process. A mocked `commit` is not a database rollback. When the behaviour under test is a crash,
a retry or a rollback, run the real boundary.

## Design boundaries that are easy to replace

**Pass dependencies in; do not create them inside.**

```typescript
// Easy to replace in a test
function processPayment(order, paymentClient) {
  return paymentClient.charge(order.total);
}

// Hard to replace
function processPayment(order) {
  const client = new PaymentClient(process.env.PAYMENT_KEY);
  return client.charge(order.total);
}
```

**One function per external operation, not one generic call.**

```typescript
// GOOD: each function returns one shape and is replaced on its own
const api = {
  getUser: (id) => fetch(`/users/${id}`),
  getOrders: (userId) => fetch(`/users/${userId}/orders`),
  createOrder: (data) => fetch("/orders", { method: "POST", body: data }),
};

// BAD: the fake needs conditional logic to answer each endpoint
const api = {
  fetch: (endpoint, options) => fetch(endpoint, options),
};
```

With one function per operation, each fake returns one shape, test setup has no branches, and you
can see which operations a test uses.

Do not add a seam only for tests when nothing else varies across it. One adapter is a hypothetical
seam; production plus a test fake is two, and that is a real one (see the `codebase-design` skill).
