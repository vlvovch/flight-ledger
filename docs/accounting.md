# Accounting rules & conventions

What this ledger counts, what it refuses to count, and why. Most of these rules
exist because a simpler version of them produced a wrong number.

## Distance and credited miles are different quantities

**Mileage is the published figure where one exists, computed only where it
doesn't.** United credits from mileage tables, not from a formula — the
community-transcribed tables in `fixtures/` differ from the great-circle
distance on essentially every pair, both directions, by up to ~20 mi. So
`npm run bis:build` folds them into `src/data/bis-mileage.json` (245 pairs, one
entry serving both directions) and a lookup comes first.

Two rules sit on top:

- **the 500-mile minimum** — a segment shorter than that still credits 500
- **the geodesic as fallback** for the overwhelming majority of city pairs no
  community table covers

The 500-mile minimum is a payout rule, not geometry, so the two quantities are
kept apart. `Dist mi` is how far you actually went — SFO–BUR is 326 mi and its
CPM divides by 326 — while the **lifetime estimate** is what United credits, so
the same flight shows `≈ 500` with a tooltip saying why. One wrinkle handled: a
table entry of exactly 500 on a shorter pair (DSM–ORD, really 299 mi) is the
floor already baked in, so the geometry wins for distance there.

`distance_miles` is *stored* per segment (computed on write), so changing the
formula needs an explicit recompute of existing rows.

## The geodesic

Vincenty's inverse solution on the WGS84 ellipsoid, not a great circle on a
sphere. The Earth's radius of curvature grows toward the poles, so a single mean
radius under-measures mid-latitude routes: IAH–SFO comes out 1,632 mi on a
sphere and 1,635 on the ellipsoid, and 1,635 is what Great Circle Mapper and the
mileage tables flyers check against say.

Validated against a 119-pair published table (`fixtures/gcdist-reference.txt`):
the sphere matched 5 pairs exactly and ran 3.7 mi light on average; the
ellipsoid matches 90 exactly and **all 118 comparable pairs to within a mile**.
Haversine is kept as the fallback for near-antipodal pairs, where Vincenty
doesn't converge.

Mileages round to the **nearest** mile (that table matches round 90 times
against 59 for floor or ceil), full precision is kept internally, and totals sum
the precise values before rounding once. The residual ±1 mi against published
tables is coordinate provenance, not error — the differences scatter both ways
with a mean of −0.02 mi, since databases disagree on where an airport's
reference point sits.

The same table's **"bis"** column — the mileage actually credited — is *not* a
distance and is deliberately not computed: it differs from the great-circle
figure on all 117 comparable pairs, scattering −16…+21 with no pattern a formula
could produce, because airlines credit from [IATA's Ticketed Point Mileage
manual](https://www.iata.org/en/publications/store/mileage/ticketed-point-mileage-tpm/)
(65,000+ published city pairs).

So a computed distance is an *approximation* of what actually posts — usually
within a mile or two, occasionally ~20 on a long haul. That is the accuracy
ceiling on any lifetime-miles estimate here, and it is why a posted value always
wins over one.

## Premier thresholds are per qualification year

United revises them. Each set below is the one United published for that year
(PQP + PQF, or PQP alone), and all of it is editable in **Settings → Premier
thresholds**.

| qualification year | status year | Silver | Gold | Platinum | 1K |
|---|---|---|---|---|---|
| 2020–2022 | 2021–2023 | 3,000+8 / 3,500 | 6,000+16 / 7,000 | 9,000+24 / 10,000 | 13,500+36 / 15,000 |
| 2023–2024 | 2024–2025 | 4,000+12 / 5,000 | 8,000+24 / 10,000 | 12,000+36 / 15,000 | 18,000+54 / 24,000 |
| 2025– | 2026– | 5,000+15 / 6,000 | 10,000+30 / 12,000 | 15,000+45 / 18,000 | 22,000+60 / 28,000 |

2020–2022 are the pandemic reductions — note they cover **three** flying years:
United announced the restoration in November 2022, which by definition applies to
flying from 2023, so 2022 still ran reduced. 2023 restored the levels United had
originally set for 2020, and 2025 raised every rung ~25%.

Beware the "2023 requirements" phrasing in press coverage: it usually means the
year you fly, but sometimes the year you hold the status — the announcement date
disambiguates.

Either route qualifies, and both sit above a floor of **four paid United or
United Express segments** — partner flights earn PQF but don't count toward it,
and the floor only ever binds on the PQP-only route.

**Coverage runs from 2020**, the first qualification year on PQP/PQF; an earlier
year still shows its totals but is given no tier, since scoring qualifying
miles/segments/dollars against PQP bars would be meaningless. Note too that
United extended status outright in 2020–2021, so what you *held* in those years
may be higher than what you *earned*.

## Status-qualifying PQP includes non-flight earning

Flight PQP comes from segments; card, shopping and hotel PQP come from activity
rows. The dashboard card shows the combined figure with the split beneath it.

The Premier breakdown speaks the **same vocabulary as the activity log** —
"Partner flights · LX", not a bare "LX flights" — and each non-flight row names
its own postings ("Promotion — Starter PQP"), because a category alone leaves
you asking which. A category with postings but no PQP (rideshare, redemptions)
is listed at "—" rather than dropped: *did my Lyft rides do anything for status*
is answered by seeing the row, not by its absence. Such a row can only join a
year, never create one.

## Lifetime miles

Flown flights with no posted value are estimated and shown with a `≈` marker
everywhere — calculated distance on UA-operated revenue flights, `0` on non-UA-
operated flights and award travel (neither accrues Million Miler miles).

Award travel is recognized by **0 award miles earned** — award tickets earn
PQP/PQF under current rules, but never redeemable miles. The CSV import also
writes the `0` explicitly for award and non-UA rows.

Entering a posted value always overrides. Note: United Express flights operated
by regionals *do* earn — leave their "operated by" field blank, or enter the
posted value.

**A flight that credits elsewhere is never given MileagePlus hints.** With the
MileagePlus tick off, the posted-value fields show "—" rather than "≈ 1" PQF or
"≈ 0 (non-UA)" lifetime miles, and the panel says simply *earns no MileagePlus
credit* — not "credited elsewhere", which would imply a choice that never
existed on a Delta flight. A placeholder is a suggestion, and suggesting a
figure the programme will never post is a wrong guess in grey.

## Cost estimation from PQP

United's PQP is revenue-based, so one PQP ≈ one dollar of base fare (measured
against this ledger's own receipts, the ratio holds within a fraction of a
percent). Flights with PQP but no ticket get an estimated cost of
`PQP × (1 + tax rate)`, where the tax rates are *learned from your own costed
tickets*, split domestic vs international, and overridable in Settings.

Estimates appear as `≈` values in the ledger and as a separate `≈ CPM` on the
dashboard — never merged into recorded costs. Award travel is excluded (miles
paid, not cash).

**A column total speaks the same language as the cells above it.** The flights
table's Gross total therefore carries the `≈` and includes the estimates its
rows show, with the recorded figure in the tooltip — two rows reading
"≈ $168.02" summing to "$0.00" said those flights were free. Personal does
*not*, because its own cells read "—" for a flight with no ticket: an estimate
is a **gross** figure and nothing is known about reimbursements.

## Cost per mile

**CPM figures are averaged over a restricted basis**: flown flights that have a
recorded cost *and* earn lifetime miles. Imported history without tickets, award
travel, and non-UA flights would dilute cents-per-mile toward zero, so they're
excluded from the averages. Cards and tables disclose the basis in miles;
per-flight rows still show their own numbers. Cost-per-PQP similarly counts only
flights with recorded cost.

Physical totals — miles, spend, PQP — always include everything.

- **Gross CPM** = 100 × allocated gross cost / flown distance
- **Personal CPM** uses cost after reimbursements
- **Effective CPM** additionally credits earned award miles at your configured
  valuation (clearly labeled an assumption)

## Cost allocation

Each ticket's cost is split across its segments: manual override →
PQP-weighted → distance-weighted → equal split (design doc §7.2), with
largest-remainder rounding so shares always sum exactly. The Tickets page shows
the full derivation; nothing is silently decided.

Canceled and refunded segments get no cost allocation. Missed segments keep cost
but earn no miles. Flown flights count toward metrics; planned and ticketed
flights appear as "booked" and carry projected cost in their future month.

**Month attribution** is by flight date (travel-period accounting, §7.3).

## Reimbursements and refunds

The usual case is "work paid for all of it", so that's the default: ticking
**Reimbursed** records the ticket's full personal cost, with nothing else to
fill in — no payer, and **no date**. A partial amount, date and payer sit beside
it and stay out of the way until there's an answer to refine — a blank amount
still means the whole thing. Unticking removes the reimbursements it stands for;
they're listed above it first, so nothing disappears without having been
visible.

The missing date is deliberate, not an omission: you usually tick the box long
after the money arrived, so stamping "today" would record a date that is simply
wrong rather than absent. (This paragraph claimed the opposite until the
cash-flow view went in and the two disagreed.) For cash-flow accounting the
undated amount is **assumed into the ticket's purchase month and marked ≈** —
the ticket is the only date the ledger actually holds, and a Back column that
answered nothing was the alternative. A real date always replaces the guess:
fill it in and the money moves to the month it actually arrived.

"In full" means the ticket's **reimbursable** cost (gross less refunds), not
what's left after reimbursing it — that would collapse to $0.00 the moment you
ticked the box.

Below sits a small **Add adjustment** form for the rest: three types, since
only three behave differently (a refund reduces gross *and* personal cost, a
reimbursement reduces personal only, and an **extra purchase** — a paid
upgrade, a seat bought after ticketing — *adds* to both), an amount pre-filled
with the whole ticket and showing what your edit comes to as a percentage, and
a date left blank for you to set. It is inert until the box is ticked — an
active form under "not reimbursed" invites you to contradict the line above it
— so a refund is recorded by ticking the box and switching the type.

Extras usually arrive by import rather than by hand: United's "Thanks for your
purchase" receipt lands as a dated extra on the ticket it names, fare
untouched, with the purchase's own document number keeping re-imports inert.
The ticket's fare stays whatever its receipt said; what the trip *cost* is
fare plus extras less refunds — and the cash-flow view dates the extra to the
day it was bought, not the day the ticket was.

When the receipt also names the **flight** the extra was bought for — an
upgrade receipt prints its leg — the extra is **pinned** to that segment, and
allocation puts the money there whole instead of spreading it pro-rata with
the fare. On a work-reimbursed round trip with a $299 personal upgrade on the
return, the upgraded leg reads gross fare-share + 299 and personal 299; the
other leg reads its fare share and personal $0. The rule behind that carries
one stated assumption: **reimbursements cover the fare before they cover
extras** — work pays the ticket, you pay the upgrade. A reimbursement larger
than the fare spills into the pinned extras, and one larger than everything
still clamps personal to zero. An extra pinned to a flight that was later
canceled falls back to spreading, and the allocation says so.

Not everything on a purchase receipt is trip cost. Inflight Wi-Fi, United
Club passes and onboard food are **consumption** — money spent on the plane,
not a change to what you flew — and they import as nothing: no adjustment, no
cash-flow row, no CPM effect; the import preview says so. The line is whether
the purchase changes the travel product, not whether it earns PQP — bags
change what you flew and stay trip cost.

On an **exchange chain** the tick lives only on the chain's last ticket: every
member reports the same chain-level total, so offering it on each of them
invites recording that total two or three times over. Superseded members don't
show a disabled form at all — their own "Value rolled into …" line already says
where it went.

Within the panel the tick and the Add button sit **above** the list of what's
recorded, and the fare summary's *Refunds* and *Reimbursements & credits* rows
are always present (showing "—" when nil) rather than appearing once something
is recorded. Both exist for the same reason: a control must not move out from
under the pointer that just clicked it, and a ledger whose rows come and go
cannot be clicked accurately.

**A reimbursed ticket also counts as business travel**, since that's what a
reimbursed trip was — but only where nothing was said: a flight's own purpose
wins, then its trip's, and only then does the reimbursement decide.

## Payments and exchange chains

Record how a ticket was funded (card, TravelBank, future flight credit,
certificate, gift card, miles); the ticket shows whether its funding adds up to
the total.

Miles fund miles, so the cash total is reconciled against the cash methods only
— counting an award ticket's miles payment as $0 of cash made every one of them
look completely unfunded. A ticket with miles and no cash method on file says
exactly that instead.

**A future flight credit is treated as cash**: a ticket bought with one costs
its face value, same as one bought with a card, and this is not a credit tracker
— you are never asked to account for where a credit came from. Provenance
matters for exactly one reason, that the same dollars mustn't be counted twice,
so an unlinked credit-funded ticket is flagged only when a ticket in the ledger
could actually be the source: one still holding cost that none of its own
flights is earning.

**A reissue chain is costed as one economic unit**: cash = the first ticket's
face value + the "additional collection" on each reissue − any residual credit
handed back, allocated in one pass across every flight the chain actually flew.

Receipts often print neither figure, so both are inferred from the difference
between consecutive face values — more expensive means new money collected,
cheaper means credit returned. An explicit residual credit on the ticket always
overrides the inference, including a deliberate `0` for the rare fare that
genuinely forfeits the difference.

Which is exactly why the receipt's **"Total Credit" line is not one**: it is the
balance of your whole future-flight-credit bank after the purchase, and it can
hold value from tickets this one never touched. Read as a residual it turned a
real $179.48 chain into −$362.80. It's recorded as a note on the ticket instead.

A reissue also **takes the flight with it**: when the leg is still attached to
the ticket this one replaces, it moves without asking, because that is what a
reissue is — leaving it behind strands a live leg on a superseded ticket. A leg
on any *other* ticket is still a conflict for you to decide. Superseded legs are
canceled and take nothing, so no dollar is counted twice and no manual refund
entry is needed.

Because each ticket in a chain keeps its own face value, tickets that belong
together are **shown together**: the Tickets list folds a chain into one panel
headed by the shared confirmation code, an "Exchange chain" tag and the line
"3 tickets · $1,117.52 spent in total, shared by the flights that flew — not
once per ticket".

Each member row shows **Face** and **This ticket** (its own allocated share)
rather than Gross/Personal, so the column sums to what you actually spent
instead of to the sum of face values — a reissue is printed for the whole
itinerary *including* the value carried over from the ticket it replaced, so
face values overlap and must never be added up. Both labels explain this on
hover.

Grouping keys on the chain link where one exists — the same link the cost math
uses, since a reissue can be handed a new record locator — and falls back to the
confirmation code for tickets from one booking that were never chain-linked
(tagged "Same booking", totals simply added).

Canceled flights are unticked by default in the Flights status filter; they're
kept, never deleted, because they're the record of why a reissued ticket exists.

## Matching engine

Activity rows are scored against the ledger on weighted features — date, flight
number, route, carrier (design doc §11.2). ≥90% links automatically, 70–89%
becomes a suggestion you confirm, and every proposal explains itself ("Flight
date exact · UA604 exact · SFO → IAH exact").

Two equally good candidates are never auto-linked. Values that contradict what
you entered become per-row conflicts ("Use United's" / "Keep mine"). Posted
values are never overwritten by estimates.
