# API: example feature

| Endpoint | Auth | Purpose | Request | Response | Errors | Flag |
|---|---|---|---|---|---|---|
| `GET /example/ping` | public | Demonstrates a feature-owned route | none | `200 {"feature":"example","ok":true}` | 404 when the flag is off | `example` |

Not part of `docs/api/openapi.json`, which lists core routes only.
