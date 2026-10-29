# Personal data breach procedure: skeleton

A skeleton for the shop operator to complete with counsel. It lists the steps and what the system gives you for each; it fixes no deadline, authority or wording. Nothing here is legal advice. TODO(fluxkit): legal review of the whole procedure, the notification duties and the contacts (plan task O8).

Fill in before launch (TODO(fluxkit): legal review for each):

| Field | Value |
|---|---|
| Person who decides (breach lead) and deputy | TODO(fluxkit): legal review |
| Counsel and their out-of-hours contact | TODO(fluxkit): legal review |
| Supervisory authority and how it is notified | TODO(fluxkit): legal review |
| Hosting, mail, carrier and payment provider security contacts | TODO(fluxkit): legal review |

## 1. Detect

Signs: an unexpected admin sign-in or privacy export, a provider notice, a report from a customer, a stolen device, a leaked secret.

What the system gives you:
- **Audit log** (owner only): `GET /admin/audit-events` and the admin Audit log screen list admin actions with who did them: privacy lookups, exports and erasures, customer and admin user changes (`docs/api/audit.md`). It holds codes and ids only. It does not record sign-ins, reads of orders or customers, or a breach.
- **Server logs**: the API writes errors and job summaries to stdout; the Compose example rotates them (`docs/deployment.md`, Logs). The API has no request log of its own. The edge proxy's access log holds client IP addresses and URLs; keep its rotation in mind, because an old line may be gone.
- **Sign-in state**: failed-login counters and lockouts on customers and admin users.

## 2. Contain

Actions that exist today:
- Deactivate an admin user (`PATCH /admin/users/{id}`, ends all their sessions) or reset their password (`POST /admin/users/{id}/reset-password`, ends all their sessions) (`docs/api/auth.md`). Owner only.
- Deactivate a customer (`PATCH /admin/customers/{id}`, deletes all their sessions) (`docs/api/customers.md`).
- Rotate the provider keys (`NOVA_POST_API_KEY`, `RESEND_API_KEY`, the payment provider's token) at the provider and in `infra/production.env`, then restart.
- Rotating `ORDER_TOKEN_SECRET` breaks guest order links and emailed reset and verification links, and the HMAC the privacy requests use to match an email (`apps/api/src/privacy/privacy-config.ts`): decide with care (`docs/deployment.md` lists it with the secrets to back up).
- Isolate the host or the edge proxy at the hosting provider.

There is no one-step "end all sessions" tool and no switch that puts the shop in read-only mode. TODO(fluxkit): decide whether such tools are wanted.

## 3. Assess

Questions to answer and write down (the shop's own log, see section 6): what happened and when; which systems; which data (use `docs/privacy/data-inventory.md` and `docs/privacy/ropa-template.md`); how many people; whether the data was readable (hashes versus plain contact data); what the consequences are for them.

Tools:
- **Look up and export** by email: admin Personal data, Look up by email, and the export (`docs/privacy/README.md` section 3) show what the shop holds for one person. Each lookup and export is recorded in the audit log.
- **Which orders and accounts** a time window touched: the orders and customers screens and the journals (`order_status_change`, `payment_event`, `stock_movement`).
- **Backups**: a restore brings back data erased since the backup; see `docs/privacy/README.md` section 4.

Whether the event is a notifiable breach, and its risk level: TODO(fluxkit): legal review.

## 4. Notify the supervisory authority

The legal deadline, the content and the form of the notification: TODO(fluxkit): legal review (counsel supplies the deadline and the authority; the template states none). Record the time the shop became aware, because the deadline may run from it.

## 5. Notify the people concerned

Whether and when to notify, the wording and the channel: TODO(fluxkit): legal review. The shop sends transactional mail only through a provider (`EMAIL_PROVIDER`); there is no bulk-mail or notice tool in the template. The addresses come from the export or the orders and customers screens.

## 6. Log and review

- **The breach log is outside the system.** The audit log has a fixed list of actions (`docs/api/audit.md`) and none for a breach, so do not record one there. Keep the log in the operator's own records: facts, effects, actions, notifications and their times.
- After the incident: fix the cause, rotate what was exposed, update this procedure, and note whether the data inventory needs a new entry.

## What the system does not give you

Intrusion detection, alerting, a request log with the visitor's identity, a re-apply tool for erasures after a restore (`docs/privacy/README.md` section 4), a tested restore (`docs/deployment.md` says it has never been tested here).
