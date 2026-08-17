# Import formats

Twenty-three email formats are recognized. Each airline and agency has its own
conventions, and most of the work in this parser is in the exceptions rather
than the happy path. This file records what each format does differently and
why the code treats it the way it does. One format is different in kind: not
one airline's conventions but the schema.org markup standard many airlines
embed, which is what catches a carrier nobody wrote a parser for.

Anonymized fixtures for every format live in `fixtures/anonymized/`, and the
selftest parses all of them on each run. Eighteen are real third-party emails
— which is how each came to carry a quirk the synthetic ones didn't — from
two MIT-licensed corpora: eleven from
[email-to-lunchmoney](https://github.com/evanpurkhiser/email-to-lunchmoney)
(both Delta receipts, the American receipt variant, the United receipt with an
extras card, both Southwest emails, four Chase Travel receipts, and the
Capital One receipt — loyalty and traveler numbers scrubbed) and seven from
[partiu](https://github.com/thiagodsti/partiu) (both Azul layouts, LATAM,
both SAS documents, Wizz, Kiwi).

One fixture is **negative**: `negative-brussels-airlines.eml`, a Brussels
Airlines email (from partiu, flattened to plain text — the detectors read
flattened text anyway). Its job is silence: every detector must leave it
unmatched, and Brussels especially, being Lufthansa-group and therefore the
nearest real neighbour to a format we do parse. Azul used to be a second
negative — until an Azul parser landed and correctly claimed it, which is the
whole point: a negative can only be an airline nobody parses.

## What an import does

Drop `.eml` files anywhere on the Tickets page and the review dialog opens on
them directly; the **Import receipts** button does the same for anyone who'd
rather pick files. A stray drop that misses can't navigate the browser away
from a batch you're reviewing.

An import creates or updates tickets with the real fare breakdown and payment
method, attaches matching flights (date + route, ±1 day for posting-date
drift), fills scheduled metadata (times, cabin, fare class, seats), and creates
missing segments. Award receipts record the cash part as cost and note the
miles redeemed.

The **MileagePlus Accrual** table is imported as *projections*
(`projected_*` fields, shown as `≈` on booked flights and as "+X booked" on the
PQP card) — planning data kept strictly separate from posted values, so
reconciliation alerts and CPM math never see them. Posted PQP and award miles
still come only from the activity CSV.

A ticket can be paid several ways at once. The payment methods are simply the
lines between "Method of payment:" and "Date of purchase" — never an allow-list
of card brands, which silently truncated a receipt at "Miscellaneous Document"
and reported the rest of the funding as missing.

Every fare part is cross-checked against the stated total, **including on award
tickets**, where a zero fare makes a dropped tax line otherwise invisible. That
check is what surfaced "Italy Security Bag Charge" being thrown away by a
blanket "bag" exclusion meant for the baggage-allowance table.

## Getting the emails out of the mailbox

The importer reads `.eml` files — and whole **`.mbox`** files, because that
is what Gmail can actually produce in bulk. Gmail's web interface downloads
only one message at a time, but **Google Takeout exports an entire label as
one mbox**: make a Gmail filter for `from:receipts@united.com OR
from:notifications@united.com OR from:unitedairlines@united.com` (receipts
alone misses cancellation notices, which arrive from the other senders),
apply a
label, then Takeout → Mail → just that label. Drop the resulting file on the
Tickets page and every message inside rides the normal pipeline. A batch
holds up to 5,000 messages (with a 100 MB backstop) — deliberately more than
any real mailbox, because the preview's cross-file reasoning (a reissue in
one email deciding whether a leg in another actually flew) only works within
one batch. In the truly pathological overflow case, replays are inert
(document numbers and duplicate detection dedupe everything), so the
continuation is simply dropping the same file again. The review digest
counts the whole batch and collapses the noise — replayed messages reading
as up to date, the newsletters a label drags in — behind toggles.

One reach extends past the batch: a reissue whose predecessor is already a
ledger ticket cancels the predecessor's still-unflown legs the new itinerary
dropped — the reissue is the only document that will ever say those legs
died, and it may well arrive alone. Legs the new itinerary keeps are moved,
not cancelled; anything flown, reconciled or already cancelled is history
the receipt has no standing to rewrite. On a re-import after the chain
already linked, the ledger's own predecessor link stands in for the printed
number (which is often a companion's coupon the ledger never had). A leg
due to fly the very day of the reissue is asked about, not assumed:
"ticketed" can simply mean nobody marked the morning's flight yet, and a
same-day reissue cannot say which side of departure it landed on — days
strictly after the cut stay verdicts. Either answer leaves a mark:
"Cancel it" cancels, "It flew" records the leg as flown awaiting
reconciliation — a row left "ticketed" would ask the same question on
every re-import.

Receipts listing several travelers record the **ledger owner's** eTicket
(matched against the member name in Settings), not whoever the airline
printed first — a companion's number as the ticket's identity misfiles every
later document that names it. A ticket the ledger already met under the
companion's number keeps it: identity continuity outranks retroactive
correctness, because switching numbers on a re-import would fork the chain.

Desktop mail clients are the other bulk path: Thunderbird or Apple Mail can
select a whole search result and save it out as `.eml` files. Outlook's
drag-out produces `.msg`, which this importer does not read — Outlook users
want the Thunderbird route.

## Fixture intake

Every fixture cut from a real mailbox goes through
`scripts/sanitize-fixtures.py` before it is committed: run the scrub, then
`npm run fixtures:scan` until it reports clean. The scanner works on
**decoded** MIME content — raw grep is blind to base64 attachments and to
quoted-printable soft breaks that split a name mid-word, which is exactly
how a real passenger's e-ticket PDF once sat unnoticed inside an
"anonymized" fixture. What the scanner cannot know is a human name spelled
in prose: read the decoded body once yourself, and hand any names it finds
to the scrub's `--replace` flags.

## The agency-locator rule

Agency and OTA documents (Amex Travel, Chase Travel, Capital One Travel,
ADTRAV/RezDesk, CTP, CWT, Kiwi.com) all key on the **airline's** booking
reference, never the agency's own locator, trip ID or RezID. An agency locator
matches nothing else in the ledger.

Neither Amex nor Chase splits fare from tax, so only the invoiced total is
recorded for those.

## United

Seven documents: the **eTicket Itinerary and Receipt**, the **booking
confirmation**, the **"Your United reservation for … is processing"** change
notice, the **"Thanks for your purchase with United"** extras receipt (whose
pre-2022 subject, **"Receipt for Ancillary Purchase with United"**, is the
same layout), the **"Your United purchase is being refunded"** notice, and
the **"Your flight cancellation is complete"** notice from
notifications@united.com — a different pipeline than receipts@, printing no
itinerary and no money: identity is the confirmation code alone, and it
cancels the *booking's* not-yet-flown legs, read out of the batch or the
ledger, through the same departed-before and reconciled-outranks rules. It
reaches only tickets from its own era — issued within roughly a year before
the notice — because United recycles six-character codes, and a code match
alone must never cancel an old stranger's booking.

The seventh is the same event told by the other pipeline: **"You've
successfully canceled your reservation (ABC123)"**, from receipts@, in the
full eTicket layout — itinerary, fare summary and all. Read as a receipt it
imported the flights it was announcing the end of, and they went on to look
flown; the subject is the only thing separating it from a booking, so the
subject is what it is read by. Its scope is the word it uses: the
*reservation*. The printed legs are dropped and the notice names the
booking, because a re-accommodated booking holds legs under that code which
the printed itinerary does not list — a nonstop re-routed through a hub
keeps the confirmation and changes the ticket, and the nonstop it replaced
dies with the reservation too.

### Purchase receipts for extras

The extras receipt covers something bought AFTER ticketing — a Premium Cabin
Upgrade, a seat — and it is not a ticket, though it tries hard to look like
one: it opens with the same "Flight 1 of 1" line as an eTicket receipt, and
before it had a parser, a $299 upgrade masqueraded as the ticket's fare. The
subject line is the test; the body phrase "A receipt of your purchase is shown
below" is boilerplate the eTicket receipt shares.

It names the eTicket it belongs to, and each item carries its own EMD
reference. The import turns each item into a dated **"extra purchase"**
adjustment on that ticket: the fare stays exactly what the ticket's own
receipt said, the derived cost becomes fare + extras − refunds, the cash-flow
view dates the money to the day it was spent, and the EMD stored in the row is
what makes re-importing the same email inert. If the ticket isn't in the
ledger yet but its eTicket receipt travels in the same batch — one mailbox
drop carries both — the extra attaches to the ticket that batch creates,
resolved by number and pinned to its flight at apply time. Only a truly
absent ticket asks you to import the eTicket receipt first.

The receipt also names the **flight** the extra was bought for, and the
import pins the adjustment to that segment — so the $299 upgrade lands on the
upgraded leg's own cost, not smeared pro-rata across the round trip
(accounting.md covers the rule and its one assumption: reimbursements cover
the fare before they cover extras).

Which purchases earn PQP is the item label's job to say — with two words
that lie: "upgrade" appears in Wi-Fi tier bumps (consumption) and in
PlusPoints upgrade **fees** (a co-pay on an award upgrade, not a purchase);
neither earns, and both are excluded before the earning test runs. Per the
MileagePlus programme terms, **seat purchases and paid upgrades** earn ≈1
PQP per dollar;
Wi-Fi, bags, United Club and inflight purchases do not — they still cost
money, so they still import as extras, but they project nothing and the
preview says so. The projection is computed over the **eligible items**,
never the receipt total, because the total can include taxes (a $35.99 seat
assignment with $2.70 tax earns PQP on the 35.99). It fills the flight it
upgrades as a projection — planning data like every other `projected_*`
figure, shown as `≈` until the activity CSV shows what actually posted.

PQP eligibility is one axis; whether something is **trip cost at all** is
another. Inflight Wi-Fi, United Club passes and onboard food are consumption
that happens to occur on a plane — a coffee-shop purchase at 35,000 feet, not
a change to the travel product — so they stay out of cost, CPM and cash flow
entirely: the receipt is recognized, the preview says why, and nothing
imports. On a mixed receipt the seat imports and the Wi-Fi does not. Bags and
priority boarding are deliberately *not* consumption — they change the
product, so they remain trip cost, merely PQP-ineligible — and the test is
conservative: anything unmatched stays cost. The real Wi-Fi receipt that set
this doctrine also proved two quirks of the variant: it carries **no eTicket
number at all** (Wi-Fi attaches to nothing, which alone would have kept it
out), and it writes the item's amount bare — only the Total line names the
currency — so the item pattern treats the currency code as optional.

An eTicket receipt can end with an **Additional Purchase Summary**: an extras
card — a Basic Economy seat assignment, say — bought as its own transaction,
sometimes on a different card, with its own tax line and its own total. None of
it is the ticket's fare. The parser stops reading money at that header and
reports the extra purchase in a note instead; before that guard, the card's
tax line bled into the ticket's taxes and made an honest receipt look
mis-summed, and its payment method overwrote the ticket's.

### Refund notices, and forwarded husks

The refund notice reuses the purchase layout with the money flowing BACK —
its item line reads "( Refunded Reference Number: …)" — and it must never
look like a purchase: no payment is read, nothing projects, and nothing
imports. A refunded consumption item (Wi-Fi, in every specimen so far) was
never in the ledger's cost, so nothing changes; a refunded seat or upgrade
that WAS imported gets a pointer to the ticket carrying it, found by the EMD
reference in the adjustment's notes, with the refund adjustment left to the
user — the template names no eTicket, so the reference is the only way home.

A related trap arrived in the same mailbox: **forwarded and quoted copies**
("Re: Fwd: eTicket Itinerary and Receipt …") carry the boilerplate that trips
the eTicket detector, but the quoting mangles every line the parser reads. A
parse that found *nothing* — no confirmation, no ticket number, no money, no
flights — is treated as a husk and left unrecognized rather than becoming an
empty ticket.

### Reservation change notices

A reissue in everything but name: they carry the new itinerary plus the
economics of the change — *New trip*, *Original trip*, *Change fee*, *Total
amount paid*, *Total credit*. Two things make them awkward.

They carry **no eTicket number**, so a notice is identified by its booking plus
the date of the change, and the chain is built by ordering a booking's documents
by date — each notice replaces whatever came immediately before it, whether that
is a ticket or an earlier notice.

Their itinerary is **forward-looking**: a leg that has already flown is simply
absent, which is never a cancellation.

Unlike the eTicket receipt's "Total Credit", the credit here is checkable —
original − new − taxes difference must equal it — and only then is it recorded
as a residual. A real three-document booking: $2,185.93 ticket, changed to
$1,215.26 ($970.67 back) and then to $1,184.08 ($31.18 back), costs the flights
that flew $1,184.08.

## American Airlines

Trip confirmations ("Your trip confirmation (IAH - CMI)") are itinerary and
receipt in one email, and a non-United ticket belongs in this ledger like any
other: it costs money and flies miles.

Legs are parsed by anchoring on the flight line, because everything around it
moves — a codeshare pushes "Operated by Envoy Air / as American Eagle" between
the flight and its destination, and only the first leg of each day carries a
date.

The ticket records `issuing_carrier: AA`, which matters downstream: a flight on
a ticket **another airline issued** is never chased for missing MileagePlus
credit, because it earns that airline's programme instead. The test is the
ticket's issuer, not the carrier — a Lufthansa leg on a United ticket posts to
MileagePlus perfectly well.

American has a second layout — **"Your trip confirmation and receipt"** — that
prints the locator inline ("Record Locator: EIKCON") rather than as a
two-line "Confirmation code:" block, and itemises extras as their own ticketed
documents: "Paid Seat (SFO-DFW)" with a document number of its own, *inside*
"Total cost". The extra lands in ancillary fees, so the parts still reconcile
with the total the receipt itself states — the opposite handling from United's
extras card, and both are right, because each receipt's own arithmetic says
whether the extra is inside or outside its total.

## Delta Air Lines

**"Your Flight Receipt"** splits every flight across three tables, and the
parser knits them back together. The flight block prints the date **without a
year** ("Sun, 08MAR") and the cities **by name** ("NYC-KENNEDY"); the Checked
Bag Allowance table prints the same flight as "Sun 08 Mar 2026 JFK-SFO" —
year and airport codes, but no times; and seats live in a third FLIGHT/SEAT
table keyed by flight number. The block-to-bag pairing is strictly one-to-one:
a same-day connection prints one bag line for the whole fare component, and
handing its endpoints to both legs would invent a nonstop — so an unpairable
flight is reported for manual entry, not guessed.

Every amount is printed as "$212.82 CAD", so the currency rides on the amounts
themselves — a Montréal departure bills in CAD on the identical layout. Cabin
brands are Delta's own and are mapped, not echoed: Delta Main and Comfort+ are
Economy, Premium Select is Premium Plus, Delta One is Business; the booking
class letter in parentheses is kept verbatim. A codeshare stars the flight
number ("DELTA 5449\*") and explains the star in a footnote the parser doesn't
need.

The detector keys on the receipt layout — the subject ("Your Flight Receipt")
or the sender plus a TICKET AMOUNT line — never the sender alone: Delta's
booking confirmations come from the same address with no charges in them, and
those should fall through to the schema.org markup fallback, where they parse.
The receipts themselves embed **no markup at all**, so the text parser is the
only path to the money.

## Alaska Airlines

Alaska's flight dates carry **no year** — a block says "Mon, Apr 11" and
nothing more — so the year is resolved against the email's own date, taking
the first candidate that doesn't put the flight before the booking. (Delta
shares the quirk, but its receipts print the year elsewhere in the document;
Alaska's don't, so the email date is all there is.)

They set the agency-locator trap in a new guise: on a codeshare, Alaska drops
its own "Confirmation code:" block and prints the **operating** airline's
instead ("Confirmation Code: B67284" under a Hawaiian-flown leg), so its own
code survives only in the subject line. The subject wins, and a code found
inside a flight block is never used.

A codeshare records both sides — "Flight 528 (Alaska 8241)" is stored as Alaska
8241 operated by Hawaiian — and the "†" that Alaska prints where a seat would go
is a note to ask the operating airline, not a seat.

Post-merger, the same document also arrives from **hawaiianairlines.com** in
Hawaiian dress ("Your flight is booked: HRGOIV…", "Mahalo"), on Alaska ticket
stock. Its flight head is "Flight 1 · Sat Aug 15", where the number is an
**ordinal**, not a flight — the real one sits two lines later as "AS 1064 ·
Boeing 717-200" — and a date in the head is what tells the two layouts apart.
Seats and class print per traveler ("14F · Class: L COACH"); the first
traveler's line is the one recorded, matching the first ticket being the one
recorded. The charge sentence dropped "fare of" and wears a scheme prefix on
the card number ("…the VISA card with number VI8930"); both spellings are
read. Its schema.org markup names the carrier under `provider`, where the
older convention says `airline` — the markup reader accepts either, and when
a future template drifts past what the text parser knows, a receipt with
money but no recognized flights adopts the markup's itinerary rather than
filing a ticket with no flights, and says so.

## Lufthansa

Booking details carry the ticket number and the full price, so they stand in for
a receipt. Every convention is its own: European dates ("Mon. 20 December 2021:
San Francisco – Munich"), 24-hour times with a unit ("13:30 h") where an arrival
past midnight says "+1" rather than changing the date, and a price table
flattened to *Adult / fare / taxes / passengers / total*.

They are the only format that names the **operating carrier in words** under
each leg ("operated by: United Airlines"), which is recorded — on a Lufthansa
ticket it is the only way to know whose metal you are on.

That matters more than it looks: a UA-operated transatlantic leg on a Lufthansa
ticket was credited to Miles & More, so it earns **no MileagePlus lifetime
miles** despite being United metal.

## SAS

Two documents. The Swedish **bokningsbekräftelse** carries the whole trip:
legs are "Stockholm ARN - London LHR" route lines whose *next* line is a time
range — a trip-summary line in the identical shape is followed by the date
instead, and that is how the two are told apart. The flight sits in a
"… | SK 533 | SAS" details line, and a partner-operated leg keeps its own
number ("| VS 449 | Virgin Atlantic"). The money block prices an award —
"Flygning" in points against "Skatter och avgifter" in SEK — and a party of
two divides to one traveler's share, like every multi-traveler receipt here.

The English **"Electronic Ticket Itinerary and Receipt"** email is the other
document: a courtesy note whose entire content — itinerary and money — lives
in a PDF attachment this importer doesn't read. It is recognized precisely so
the import can say that, instead of "unrecognized file".

## Southwest

Trip itineraries with numbered "Flight N:" blocks (plus a slimmer pre-trip
reminder), and **no money on either** — Southwest bills on a separate purchase
receipt that isn't in any public corpus. The import scaffolds the flights,
dates and times, and says exactly why the ticket has no amounts: the same
honesty rule as the markup fallback, flights without invented zeros.

## Azul

Portuguese purchase confirmations ("Reserva TQJWFX realizada com sucesso") in
two layouts whose one meaningful difference is the flight datetime: with a
year in one ("02/03/2026 - 13:20"), without in the other ("02/03 • 13:20").
Day comes first in both — 02/03 is March 2nd — and the year-less form
resolves against the email's own date, Alaska's rule again. The money
reconciles: Tarifa Total plus the seat charge plus Serviços equals Total da
Passagem, in R$ (BRL). Payment can be **PIX** — an instant bank transfer, not
a card — recorded as printed.

## LATAM

Portuguese purchase confirmations with a positional itinerary around the
flight line — date, time, city, "(FLN)" above it, the same four below for the
arrival — and one money line: "Total: BRL 632,86". The receipt itself says the
breakdown travels as a PDF attachment, which this importer doesn't read, so
only the total lands and a note explains why.

## Wizz Air

"Your travel itinerary: GW8PSD" usually arrives forwarded, so the detector
reads the wizzair.com address out of the forwarded header block in the *body*
— the envelope From is whoever forwarded it. Dates are day-first, departure
and arrival share one line, and the charges table prints one "Fare price" line
per passenger plus an administration fee summing to the grand total — a party
of two divides to one traveler's share on import.

## Amex Travel

An OTA document, so the airline's `RECORD LOCATOR` is the key and the "Trip ID"
in the subject is ignored — that one is Amex's own and matches nothing the
airline ever sends you.

Their flight blocks are almost entirely unlabelled: the airline is a *name* on
its own line with the number beneath it, the times are a range on one line
("1:55pm - 4:03pm"), the route is split over two ("Seattle WA, SEA -" / "San
Francisco CA, SFO"), and the date carries no year. There is no fare-class letter
anywhere, only a cabin, so none is invented.

The issuing airline comes from the **ticket-number stock prefix** (027 →
Alaska), which outranks guessing from the itinerary.

## Chase Travel

Keys on the *airline* confirmation, not the Chase trip ID, so bookings match the
rest of the ledger. Per-leg dates are read from the cancellation-rules section.
Chase doesn't itemize fare vs tax, so only the total is recorded.

Three vintages of the layout are read. The newest drops "Flight N:" headings
for **Depart:/Return: bounds** — date on the bound, times and codes beneath,
the fare brand and class letter after a "Fare:" label — and a one-stop bound
prints both flight numbers but only the stop's code, in parentheses with the
layover ("(TPE — 22h 15m)"): the legs are split around the stop, and the
second leg's unprinted date is flagged rather than guessed.

The newest layout can also be paid in **Ultimate Rewards points**, wholly or
partly ("Trip total: 53,934 points + $98.29"). Points follow the same rule as
award miles: the cash actually billed to the card is the ticket's recorded
cost — zero, when points covered everything — and the points are noted as a
payment, never priced and never filed as miles. A note states the full trip
price and what the points covered, so nothing is silently discarded.

## Capital One Travel

The same agency rules with one twist: a "multiple itineraries" trip is really
**two tickets**, with a separate airline locator per direction — both are
surfaced, the booking is recorded under the first, and Capital One's own
"H-H-…" code is skipped as the agency locator it is. Fare details are per
traveler and reconcile exactly: base plus taxes per person, plus the party's
seat-selection total, equals each share of the stated total.

A card benefit ("Annual Travel Credit Applied −$300.00") reduces what the
card was charged, **not** what the ticket cost — it is reported as a
statement-credit suggestion, never netted out of the fare.

## ADTRAV / RezDesk

ADTRAV re-sends an itinerary on every schedule change, carrying only the trip
that changed — so a leg the newest copy doesn't mention is treated as
unrepeated rather than superseded, and still imports, attached to the ticket by
number.

## CWT

Trip documents ("Trip document (e-ticket receipt)") follow the same agency rule
as Chase Travel and ADTRAV: key on the airline's **Booking Reference**, never
CWT's own trip locator.

Their itinerary is labelled rather than positional — DEPARTURE / ARRIVAL /
Seat: / Class: / Operated by: — but each value is spread over several lines, so
a leg is read as the block between one DEPARTURE and the next.

The issuing airline comes off the ticket line ("Ticket: … DL"), and the card off
the same GDS scheme code ADTRAV prints. When a document names one form of
payment against a stated total, that payment's amount *is* the total — the
amount stays unknown only where several methods share a bill.

## CTP (Collegiate Travel Planners)

A university travel desk, and the third agency format to print **two** booking
references: "Agency Reference Number: ZGPDYH" is CTP's own filing number,
while "United Airlines Confirmation number is ZZ0014" is the record locator
the airline knows — the only one that will match the airline's own receipt
for the same trip, per the agency-locator rule above.

Every field sits on the line after its label, and the fare block itemises the
ticket and the agency's **service fee** as separate charges to the same card.
The fee is real money the trip cost, so it lands in ancillary fees, and the
total recorded is CTP's own "Total Amount".

## Kiwi.com

The OTA confirmation explains, in its own words, why there is nothing to
import: the carriers' locators live in Kiwi's app, the payment is "successful"
with no amount printed, and the itinerary is two city names. Kiwi's own
nine-digit booking number is an agency locator, which matches nothing in this
ledger. The format is recognized precisely so the import can say all of that
instead of shrugging "unrecognized file" — and point at the airline's own
receipt as the document worth importing.

## Any airline: embedded schema.org markup

Many carriers annotate their confirmation emails with the Gmail/Outlook email
markup standard — a `FlightReservation` block of JSON-LD inside the message
itself. It is the airline's own machine-readable statement of the itinerary:
booking reference, passenger, flights, airports, departure and arrival on each
airport's own clock. The parser tries it **last**, after every text format: the
standard has no fare, tax or total fields at all, so any format that can read
money gets first claim.

What the markup's shape dictates:

- **One `FlightReservation` per passenger per leg** is the spec's
  multi-traveller form, so identical flights fold into one segment and the
  passenger count is carried separately.
- **Cancelled reservations create nothing**, and a booking of nothing but
  cancellations is no document at all.
- **The issuer is inferred from the flights' airline** — the markup never says
  who issued the ticket. One airline throughout means that airline; a mixed
  booking says so in a warning.
- **No fare is ever claimed.** The preview states it outright: the ticket lands
  with no cost until a receipt or your own entry fills it. A later money-
  bearing document for the same confirmation updates the same ticket — markup
  scaffolds, receipts fill.

Adoption varies by airline and era, and some carriers have scaled their markup
back — this format catches whatever fraction of the inbox carries it and falls
through cleanly for the rest.

And when a text format **did** match, the markup is read anyway — as a
witness. The airline has stated the itinerary twice in one email, once as text
for people and once as data for machines, and if the two disagree either their
template drifted or our parser did. Contradictions on a matched leg (same date
and route, different flight number or departure time) surface as warnings in
the preview; confirmation codes are compared only on airline documents, never
agency ones, because an agency's markup may carry its own locator — the same
trap the agency-locator rule exists for. Set differences stay silent: change
notices are forward-looking, so a leg one side lacks is normal life, not a
discrepancy. The text parser stays authoritative either way — it is the one
that reads money.

## A receipt proves purchase, not travel

A past leg on a receipt is recorded as flown only when nothing else in the
import contradicts it — and "past" is judged by the **scheduled arrival**
where the receipt prints one: the destination's clock (approximated from its
longitude), the printed arrival time, an extra day when the arrival clock
reads earlier than departure, and a six-hour margin for delays and the
approximation. A leg with no printed schedule falls back to the day rule:
before today, not today — a flight departing this evening has not flown,
however early the receipt was printed. Nothing then advances that status on
a timer — this app does not claim travel happened — but re-importing the
same receipt after arrival moves it, and Reconcile lists any leg still
marked upcoming whose scheduled arrival has passed, judged by the same rule
(`src/lib/arrival.ts`), so the two can never disagree. Two documents can, and each carries the date that says
which coupons it voided:

- a **reissue** voids only coupons that hadn't departed when it was issued
- a **cancellation notice** voids only travel that hadn't departed when the
  notice was *sent* — it reprints the whole reservation, legs you already flew
  included, so its send date is the cut, not the legs it happens to list.
  One refinement, from a real eleven-reissue chain: United has emailed a
  midnight cancellation the next morning, making a flight that never flew
  look already-departed. A coupon issued **on or after its own flight day**
  (a same-day change), cancelled by an email at most a day later, never
  flew. The notice's printed date can't be the cut itself — it is the
  ticket's issue date, months old on a reservation cancelled late in life.

The same ownership rule holds inside an **exchange chain**: a predecessor's
receipt never claims a segment owned by another ticket in its own chain.
Cancel an award booking and rebook a day later in the same PNR, and the old
receipt's leg sits within ±1 day of the flown replacement — instead of
stealing that segment and dragging its date backwards, the receipt creates
its own leg, which the ledger-linked reissue rules void as travel that never
flew.

A cancellation also cancels the **booking it names, not the itinerary**.
Cancel-and-rebook puts the same route and date on a second ticket; when the
matched flight's owner resolves to a different ticket, the notice keeps it and
says whose it is — the flown flight on the rebooking is not a decision to put
to the user. Only a segment on the named booking itself (or one whose owner
can't be resolved — a manually logged flight) can be cancelled. When both
bookings arrive in one batch, the in-batch copy handles itself: segments
created alongside their own cancellation notice are born canceled by the
supersession rules, and the rebooked ticket's are not.

The strongest rule of all is the **statement itself**: inside the imported
MileagePlus activity's date range, United's own posting record is treated as
authoritative. A past-dated leg the statement covers but never posted did
not fly — cancelled, changed or no-show, on evidence the mailbox may simply
lack — so it is created canceled, with the note naming the coverage range.
The premise — "if it flew, it posted" — holds only for United-marketed cash
travel credited to MileagePlus, so everything else is exempt: tickets
credited to another programme, award legs (no PQP/PQF to post, in most
eras), and partner-marketed flights, whose postings are flaky enough to have
their own "worth claiming" queue. Future legs are untouched, and the
assumption is stated: coverage is the imported activity's min–max range, so
import contiguous exports. The
rule never overrides the ledger — and a voided coupon claims no row owned
by a different ticket at all: its leg is created fresh, born canceled,
carrying its printed accrual as history that never counts toward what's
still to come. A leg that matches a posted flight claims
that row — coverage's premise is false exactly there — and only a leg
nothing claims is born canceled. Likewise a cancellation notice cancels
only tickets that existed when it was sent: cancel-and-rebook under the
same confirmation and flights makes the old notice's leg list match the
new ticket too, and the rebooking is a new coupon, not a target. The
trade-off that remains is deliberate — a flight United *failed* to credit
inside the range will import as canceled rather than surface as "worth
claiming"; the note says why, and one status flip fixes the rare genuine
miss.

Two of these rules have a **fresh-ledger** shape, for the mailbox imported
right after the activity CSV, when the flown rows are unowned and ownership
can't protect them. A cancellation never questions a **reconciled** flight —
United posted earnings for it, and a cancelled coupon never posts, so
whatever the notice cancelled, it wasn't that row. And a coupon the batch
proves was voided (reissued away, or cancelled before departure) never
*claims* a flown segment: the flown row belongs to whichever receipt
actually flew it, and the voided coupon gets its own leg, born canceled.

**Whose travel is it** is its own axis. Receipts print LAST/FIRST pax
lines, and the import reads them; when Settings names your last name (first
name optional, and required for the match when set), a booking whose
travelers don't include you — a colleague's trip booked from your account,
living in the same mailbox — is recognized, explained ("booked for X — not
your travel"), and imported as nothing: no ticket, no cost, no flights. A
multi-traveler booking that includes you imports normally, and documents
that print no names filter nothing.

A third case needs no dates at all. When United moves you to a different flight
**without reissuing**, it re-sends the whole receipt under the *same* eTicket
number. Two such emails are two snapshots of one coupon, not two flights — so
the newest copy acts and older copies go completely inert (saying why), instead
of creating a duplicate ticket on the same number, double-recording the funding,
and rewriting the flight that flew back into the one it replaced. If an older
copy lists a leg the newest one doesn't, that is called out for you to check
rather than silently dropped. Only documents that *describe* the ticket count
as copies: a purchase receipt or cancellation naming the same eTicket number
merely references it — treating one as "the newer copy" once deadlocked a
real booking, with the upgrade superseding the eTicket receipt while itself
waiting for that receipt to create the ticket.

When a reissue names a previous ticket you have no receipt for — United often
prints an interim document number — the link is inferred instead: a ticket in
the same booking that is funded *entirely* by carried-forward credit, declares
itself an exchange, and has exactly one earlier ticket in that booking nothing
else replaces, chains onto that ticket. The import says so and names what the
inference rested on; without it the booking's cost counts once per ticket.

A receipt never overrules United's own posting. If a flight is already
reconciled, its number came from the activity statement, so a receipt naming a
different flight is treated as an earlier booking state — the ticket still
attaches, but flight number, times, seat and cabin are left as posted.
(Same-day change a flight twice and the last receipt you kept may not be the one
you flew; there may be no receipt for it at all.)

These rules run across the whole import, and against chains already in the
ledger, so dropping a reissue chain in as one batch records the replaced legs as
canceled, explains each one in place, and never asks you to adjudicate a leg
that flew months before the notice existed. Chains whose predecessor arrives in
the same batch are linked after both tickets are written.

## Did this flight ever credit to MileagePlus?

This decides whether a flight can be *missing* credit at all. Three kinds never
earn:

- a ticket **another airline issued**
- an **award flown on someone else's metal** (no miles, no PQP)
- a flight with **no United ticket behind it on another airline** — a Delta or
  ITA segment added by hand was never a MileagePlus flight

A partner leg *on* a United ticket is deliberately not in that list; those do
earn.

Each flight has a **MileagePlus** tick alongside its posted values: left alone
it shows — and keeps — the inferred answer, and ticking or unticking pins your
own.

Imports don't rely on inference at all. United's receipts print `Frequent
Flyer: UA-XXXXX999`, and a ticket credited to a partner prints that partner's
programme instead (`LH-XXXXXXXXXXXX777`), so the flag is set from what the
document says. That line is the **only** thing that can catch a United ticket,
on United metal, that was credited to Miles & More — it looks United in every
other respect.

Without this the reconcile queue nags forever about flights nobody owes you
credit for, which buries the one flight that really is missing.
