# Tindero POS — retail hardware POS (free)

Runs in any browser: iPhone, iPad/Android tablet, Mac, Windows. Works offline; syncs when online.

## 1. Go live (free, ~10 min)
1. GitHub → new public repo (e.g. `tindero-pos`) → upload ALL files in this folder.
2. Repo → Settings → Pages → Source: `main` / root → Save. URL: `https://<user>.github.io/tindero-pos/`
3. Open the URL on each device → Share → **Add to Home Screen** (iPhone) / Install (Chrome/Edge on PC/Mac).
4. Login: **Owner / PIN 1234** → Settings → Users → change PIN, add cashiers.

## 2. Cloud sync across branches (free)
1. supabase.com → New project (free plan).
2. SQL Editor → paste `setup.sql` → Run.
3. Project Settings → API → copy **Project URL** and **publishable (anon) key**.
4. App → Settings → Cloud sync → paste → Save & sync now. Repeat on every device.
- Free projects pause after 7 days with no activity; daily sales keep it awake.
- One Supabase project per store/client.

## 3. AI receipt reader (free)
aistudio.google.com → Get API key → App → Settings → Receipt reader → paste.
Stock In → snap supplier receipt → lines auto-filled and matched → review → Save (stock + cost updated).

## Receiving deliveries (Stock In)
1. Stock In → Receive delivery → Take photo of receipt / DR → AI reads supplier, invoice no., date and every line.
2. Each line is matched to your products (✓ SKU) or marked NEW. Wrong match → "not this item?". The app remembers each supplier's wording for next time.
3. Bulk: Buy unit + pack qty, e.g. 2 box × 100 pc = 200 pc in stock; 1 roll × 150 m = 150 m. Cost per selling unit is calculated.
4. Sell price blank = decide later. "Fill suggested prices" fills blanks.
5. Receive → stock added, costs updated, receipt photo kept. Items needing a price go to Price review.

## Costing (retail standard)
- Average cost (moving weighted average) = cost used for profit and stock value. Updated on every delivery.
- Last cost + supplier kept per item. Cost ▲/▼ shown on receiving vs last delivery.
- Every product must have a cost. Products → "Missing cost" filter finds gaps.

## Bulk price (roll / box / sack)
- Product → Bulk unit (e.g. roll), Sell units per bulk unit (e.g. 150 m), Bulk price (e.g. 4,700).
- Sell screen: tap "by roll ₱4,700" under the cart line to switch; stock drops by 150 m. Tap again to go back to per-meter.
- Bulk selling needs the pack size set; products list shows "set pack" until it is.

## Brands
- Product form → Brand (auto-guessed from the name). AI reads brand from receipts for new items.
- Brand shows on sell tiles, is searchable, adds a brand code to auto-SKU (e.g. PT-ENM-1L-RED-BOY).
- Products → brand dropdown filter (incl. "No brand"). Reports → Top brands. CSV has a brand column.
- Product → Cost & price history: every delivery cost, cost per supplier (⭐ cheapest), every price change with who/when/why.

## Price review
Products / Stock In → Price review: items with no price + items whose cost changed.
- New item: suggested = cost + target markup (Settings), rounded (₱0.25 / ₱1 / ₱5 / ₱10 steps).
- Cost up: suggested keeps your current markup. Cost down: suggested keeps current price.
- "Keep" clears the flag without changing price. Blank = decide later.
- Items without a price cannot be sold by cashiers; owner is asked to set a price at the counter.

## 4. Load your idle main-branch stock
- Fastest: Products → Import CSV (download template; `stock` column goes into the selected branch).
- Or Products → Add → photo + Gen barcode → Save + next.
- Products → Labels → print barcode/QR price stickers (50×30 mm).
- Inventory → Transfer to move stock to satellites (satellite price auto +15%, editable).

## Product photos
Products → Photos: steps through every item without a photo. "Save & go to next automatically" is on by default.
- Mac/PC: Search web opens Google in a side window → right-click a photo → Copy Image → click the app (Chrome/Edge) or press Cmd/Ctrl+V (Safari) → saved, Google window closes, next item shows. Chrome/Edge first time: click Paste image once → Allow.
- iPhone/iPad: Search web → long-press a photo → Copy → back to the app → Paste image → saved, next item shows.
- Also works: Cmd/Ctrl+V, pasting an image link, dragging an image onto the box, or tapping the box to use the camera.

Background:
- Quick clean (automatic, ~0.05 s): plain/light backgrounds turn pure white; item is cropped and centered in a square. Toggle: "Clean background to white automatically".
- Busy background: app warns and waits → tap "AI remove background" (first time downloads ~40 MB AI model, then a few seconds per photo). Product form has an AI button too.
- AI uses IMG.LY background-removal (AGPL). Fine for own use; if reselling, keep the app source public or buy IMG.LY's commercial license.

## SKU codes
Format: CATEGORY-TYPE-SIZE-VARIANT, e.g. CM-CEM-40KG, LP-MPW-12MM, AD-CC-1L-RUG.
- Blank SKU on save = auto-generated. Product form → Auto button rebuilds it.
- Products → Auto-SKU → Fill missing / Redo all.
- Category codes: Settings → Categories & SKU codes (CODE = Name, one per line).
- Blank category is guessed from the item name (plywood → LP, solvent → AD, etc.).

## Discounts
- Per item: tap the line in the cart → Discount on this item → % off, ₱ off each piece, or ₱ off whole line → quick 5/10/15/20%. Preview shows the peso discount before Update.
- Whole sale: Sale discount + (₱ or %), applied after item discounts.
- Cashier limit: Settings → Max cashier discount % (default 10). Above it, owner PIN is required at payment; approver is recorded.
- Receipt shows each "Less", sale discount and "You saved". Reports → Discounts given + by cashier.

## Hardware
- Any USB/Bluetooth barcode scanner (keyboard mode) — just scan on the Sell screen.
- Phone/tablet camera scans barcodes and QR codes.
- 58/80 mm thermal printer via system print (AirPrint / Windows driver).

## Roles
- Owner: everything.
- Cashier: sell, stock in, stock count. Cannot edit prices, adjust/transfer stock, void, or see reports.

## Anti-theft
Stock = sum of every movement (sale, purchase, transfer, adjust, count, void), each stamped with user + time.
Inventory → Stock count records Variance = Physical − Expected per item.

## Notes
- Receipts print "This is not an official receipt." Issuing BIR receipts from a POS requires BIR registration (PTU) of the software/machine.
- Settings → Backup weekly, even with sync.
