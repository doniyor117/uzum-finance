# Uzum Seller Profit Calculator

A browser-local product planner for FBO, FBS, DBS, and EDBS. Public hosting serves
static files. Product records and previous-plan migration use only local browser
storage. Pricing scenarios share the same cost engine as the main projection.

## Planning sequence

1. Enter the SKU, purchase cost, planned list price, and order volume.
2. Select the fulfillment model and category. Use a manual rate or price bands
   when the seller cabinet gives a different rate.
3. Enter actual packed measurements and any applicable delivery or inbound
   costs. Turn on the exception groups relevant to the product.
4. Inspect the cost ledger, test markup prices, and compare the required sales
   volume and break-even list price.
5. Add quotes, credits, and contract-specific charges using a matching charge
   basis. Keep fixed charges for the same planning period as ordered units.

## Architecture

| File | Responsibility |
| --- | --- |
| `dist/fields.mjs` | Product defaults and model-specific form controls |
| `dist/tariffs.mjs` | Published fee formulas, model rules, and source links |
| `dist/categories.json` | Per-category FBO, FBS, DBS, and EDBS workbook rates plus storage metadata |
| `dist/plan.mjs` | Resolves the active model, input validity, and applicable charges |
| `dist/model.mjs` | Applies costs at their event bases and computes contribution, net profit, and break-even |
| `dist/app.mjs` | Product management, lookup, browser persistence, and results |
| `scripts/import-tariffs.py` | Regenerates the category data from the two published workbooks |

The imported commission columns contain effective rates after discounts.
Price-tier thresholds and negotiated rates can be supplied manually. Tariff
rules were checked against the official manual and offer on 12 November 2026.
A supply date affects time-slot penalties only. Order volumes and payout
charges are estimates. The return model separates items delivered and kept,
items returned after delivery, failed deliveries, and pre-dispatch
cancellations. For mixed-size return waybills or different penalty batches,
add an allocated charge with a custom line.

Run `node --test tests/model.test.mjs` to check the tariff boundaries, order
mix, and break-even results.
