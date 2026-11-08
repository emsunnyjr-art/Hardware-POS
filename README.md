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

## 4. Load your idle main-branch stock
- Fastest: Products → Import CSV (download template; `stock` column goes into the selected branch).
- Or Products → Add → photo + Gen barcode → Save + next.
- Products → Labels → print barcode/QR price stickers (50×30 mm).
- Inventory → Transfer to move stock to satellites (satellite price auto +15%, editable).

## SKU codes
Format: CATEGORY-TYPE-SIZE-VARIANT, e.g. CM-CEM-40KG, LP-MPW-12MM, AD-CC-1L-RUG.
- Blank SKU on save = auto-generated. Product form → Auto button rebuilds it.
- Products → Auto-SKU → Fill missing / Redo all.
- Category codes: Settings → Categories & SKU codes (CODE = Name, one per line).
- Blank category is guessed from the item name (plywood → LP, solvent → AD, etc.).

## Discounts
- Per item: tap the line in the cart → Discount on this item (% or ₱) → quick 5/10/15/20%.
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
