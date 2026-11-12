# Tindero POS — manual test checklist (real phone)

Run this on a real phone before every release and when setting up a new store.
Use a **test store** (its own Supabase project) or a quiet time in a real store.
Write **✓ / ✗** and the date next to each test. Anything ✗ = do not release; note what you saw.

**You need:** 2 phones (or a phone + a computer) with the app installed, the owner PIN, one cashier account (PIN you know), a barcode label or a product with a printed barcode, a 58 mm Bluetooth/AirPrint printer (or "Save as PDF"), internet you can switch off (airplane mode).

Before starting: Settings → bottom of page shows the version you are testing. Write it here: `version ____`

---

## A. Setup and health

### A1. Setup check passes
1. Log in as owner → Settings → **Setup check**.
2. Wait for the results.

**Expected:** green "Database rules are correct." All 7 Database lines ✓ (cloud reachable, cannot delete, history, secrets, record types, AI queue, AI limit). Store-setup lines show what is still to do. No red "OLD rules" banner.

### A2. Old rules are detected (only on a test project)
1. In a **test** Supabase project that never ran the new setup.sql, connect a test device (Settings → Cloud sync).
2. Settings → Setup check.

**Expected:** red banner "database problems — OLD or incomplete rules"; at least "Sync key cannot delete records" and "History of changes kept" show ✗ with "Run the newest setup.sql". Log out and in as owner → toast "⚠ … still on the OLD security rules".

### A3. Self-test
1. Settings → **Self-test**.

**Expected:** "8 of 8 passed". Products / Reports show no "SELF-TEST" items afterwards.

---

## B. Selling

### B1. Barcode scanning with the camera
1. Sell → tap the **scan** button next to the search box → allow the camera.
2. Point at a product barcode label.

**Expected:** a beep, the scanner closes, the product is in the cart with qty 1. Scanning the same label again makes it qty 2. An unknown barcode shows a "not found" message (no crash).

### B2. Normal sale, cash
1. Add 2 different items. In the cart change one quantity with **+** and **−**.
2. Tap **Cash** → enter more than the total (e.g. ₱1,000) → Complete sale.

**Expected:** change shown correctly (cash − total). Receipt appears. Inventory for those items drops by the quantities sold.

### B3. Tingi item (roll + per meter)
Use an item set up with tingi (e.g. wire, 1 roll = 150 m, price per roll and per m).
1. Sell → the tile shows two buttons: **1 roll ₱…** and **per m ₱…**.
2. Tap **per m** → in the cart set qty **12** → Cash → Complete sale.
3. Inventory → find the item.

**Expected:** total = 12 × price per m. Inventory shows sealed rolls −1 and **Open: 138 m** (if no roll was open before). Selling 140 m more opens the next roll automatically.

### B4. Item stocked per meter with a whole-roll price (two prices)
Use an item stocked per m with "Price / 1 roll" set (e.g. THHN 2.0mm: ₱35/m, ₱2,900/roll).
1. Tile shows **per m ₱35** and **1 roll (150 m) ₱2,900**. Tap **1 roll** once and **per m** once.
2. Complete sale.

**Expected:** cart shows 1 line at ₱2,900 (by roll) and 1 line at ₱35. Total ₱2,935. Stock drops by 151 m.

### B5. Remove item, clear sale, back
1. Add 3 items. Open the cart. Tap the red **✕** on one line.
2. Tap **← Back** → items list. Phone back swipe/button with the cart open → cart closes, app stays open.
3. On the orange cart bar tap **✕ Clear** → **Keep selling**; then **✕ Clear** → **Yes, clear sale**.

**Expected:** step 1 → 2 items left. Step 3 → first time nothing changes; second time the cart is empty. Stock unchanged.

### B6. Discount limit for cashiers
1. Log in as **cashier**. Add an item, tap the line → discount 50%.
2. Pay.

**Expected:** owner PIN is asked. Cashier PIN is refused; owner PIN approves and the sale completes. Receipt shows the discount.

### B7. Supplier item sold as order (out of stock)
1. Sell → search an item that exists only in a supplier price list (or is out of stock).
2. Tap the dashed "ORDER" tile → **Sell as order** → Complete sale.

**Expected:** receipt line says "(ORDER – for delivery)". Stock does not change. Close / Day report lists it under **ORDERS TO FETCH**.

---

## C. Offline and sync

### C1. Selling offline, then syncing
1. Phone 1: airplane mode ON. Make 2 sales.
2. Top bar shows "2+ to sync" (orange).
3. Airplane mode OFF. Wait up to 1 minute (or tap the sync icon).

**Expected:** status turns "Synced" (green). Reports show both sales with correct times.

### C2. Sync between two devices
1. Phone 1: change a product price, make 1 sale.
2. Phone 2 (same store): tap sync or wait 1 minute.

**Expected:** phone 2 shows the new price and the sale in Reports; the item's stock is the same on both phones.

### C3. Same product edited on both devices
1. Both phones offline. Phone 1 sets price ₱100, then phone 2 sets ₱120 (phone 2 later).
2. Both online, sync both twice.

**Expected:** both phones end with ₱120 (the later edit wins). No duplicate product.

---

## D. Receiving and AI

### D1. Receive a delivery with a receipt photo
1. Stock In → Receive delivery → take a photo of a supplier receipt.

**Expected:** within ~20 s lines are filled (names, qty, unit, cost, supplier, date). Lines match existing products (✓ SKU) or say NEW. Roll/box items show AI tingi advice ("✨ AI: sold whole" for paint, tingi per m for wire). Receive → stock goes up, costs update.

### D2. Buying per kg / m, selling per roll
1. Receive a line "203 kg" barbed wire @ ₱45 for a product sold per roll (20 kg, no tingi).

**Expected:** line asks **Rolls received** (prefilled 10) → stock +10 rolls, cost per roll ₱913.50, no loose kg.

---

## E. Shift close and receipts

### E1. Close shift with a cash count
1. Close → enter starting cash (e.g. ₱1,000). Count the bills by denomination. Add one cash expense (e.g. ₱50).
2. **Close shift & make report**.

**Expected:** Expected cash = starting cash + cash sales − expenses. Result shows BALANCED / OVER / SHORT correctly for what you counted. The report prints with "NOT AN OFFICIAL BIR DOCUMENT" boxed. Past closings list shows it.

### E2. Receipt printing
1. Make a sale → on the receipt tap **Print** (58 mm printer or Save as PDF).

**Expected:** printed: store name, branch, address/TIN (if set), receipt no., date & time, cashier, customer (if entered), each item with qty × price and amount, subtotal, discounts, **TOTAL**, payment, change, and the boxed line **ACKNOWLEDGEMENT RECEIPT — NOT AN OFFICIAL BIR RECEIPT** at top and bottom, clearly readable. **Share** sends the text including the BIR line.

---

## F. Safety

### F1. Danger zone rejects a cashier PIN
1. Owner → Settings → **Erase this device**. Type **DELETE** → Erase.
2. When asked for the owner PIN, enter the **cashier** PIN.
3. Cancel.

**Expected:** "Erase" stays grey until DELETE is typed. Cashier PIN is refused. After Cancel nothing is erased (products still there). Same for **Restore backup** and **Merge duplicates**.

### F2. Backup and restore
1. Settings → **Download backup** (keep the file).
2. Change one product's name to "TEST WRONG". Sync.
3. Settings → Restore… → choose the backup → confirm with the owner PIN.
4. After reload, log in and sync. Check the product on a second phone.

**Expected:** the product name is back to the original on **both** phones (restore wins over the cloud copy).

### F3. Recovery after a wiped device
1. Make sure the phone shows "Synced". Note product count and today's sales total.
2. Settings → Erase this device (DELETE + owner PIN).
3. Log in with the default **Owner / 1234** → Settings → Cloud sync → paste URL + key → Save & sync now.
4. Log out, log in with the store's **real** owner PIN.

**Expected:** all products, sales, users, store name and branches come back from the cloud. The real owner PIN works; the cloud still has the real PIN (other devices are not reset to 1234).

### F4. AI spending limit message
(Only if you want to test it: needs 60+ AI reads from one phone within 10 minutes, e.g. a 40-page PDF price list twice.)

**Expected:** after the limit the app shows "AI limit: too many AI reads from this device. Wait 10 minutes." instead of retrying.

---

Tested by: __________________  Date: __________  Version: ______  Result: ☐ all ✓ ☐ issues noted
