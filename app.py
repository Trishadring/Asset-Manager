"""ManaPick — MTG order picking helper for Manapool sellers."""

from __future__ import annotations

import os
import re 
import time
from collections import defaultdict
from typing import Any

import requests
import streamlit as st

st.set_page_config(page_title="ManaPick", page_icon="🃏", layout="wide")

MANAPOOL_BASE = "https://manapool.com/api/v1"
SCRYFALL_BASE = "https://api.scryfall.com"

# --------------------------------------------------------------------------- #
# Manapool                                                                    #
# --------------------------------------------------------------------------- #
FINISH_LABELS = {"NF": "nonfoil", "FO": "foil", "EF": "etched"}


def _mp_headers(api_key: str, email: str) -> dict[str, str]:
    return {
        "Accept": "application/json",
        "X-ManaPool-Email": email,
        "X-ManaPool-Access-Token": api_key,
    }


def fetch_manapool_orders(api_key: str, seller_email: str) -> list[dict]:
    """Fetch all Paid/Unshipped (unfulfilled) seller orders from Manapool."""
    if not seller_email:
        raise RuntimeError(
            "Manapool requires your seller email along with the API token."
        )
    headers = _mp_headers(api_key, seller_email)
    list_url = f"{MANAPOOL_BASE}/seller/orders"

    summaries: list[dict] = []
    limit, offset = 100, 0
    while True:
        resp = requests.get(
            list_url,
            headers=headers,
            params={"is_fulfilled": "false", "limit": limit, "offset": offset},
            timeout=30,
        )
        if resp.status_code == 401:
            raise RuntimeError(
                "Manapool authentication failed. Check that the API token "
                "and seller email are correct."
            )
        resp.raise_for_status()
        page = (resp.json() or {}).get("orders", [])
        if not page:
            break
        summaries.extend(page)
        if len(page) < limit:
            break
        offset += limit
        if offset > 5000:
            break

    detailed: list[dict] = []
    for s in summaries:
        oid = s.get("id")
        if not oid:
            continue
        r = requests.get(
            f"{MANAPOOL_BASE}/seller/orders/{oid}", headers=headers, timeout=30
        )
        if r.status_code == 200:
            payload = r.json() or {}
            detailed.append(payload.get("order", payload))
        time.sleep(0.05)
    return detailed


def mark_order_shipped(
    api_key: str, email: str, order_id: str, tracking_number: str = ""
) -> dict:
    """PUT fulfillment to mark an order shipped via USPS."""
    body: dict[str, Any] = {"status": "shipped", "tracking_company": "USPS"}
    if tracking_number.strip():
        body["tracking_number"] = tracking_number.strip()
        body["tracking_url"] = (
            f"https://tools.usps.com/go/TrackConfirmAction?tLabels={tracking_number.strip()}"
        )
    r = requests.put(
        f"{MANAPOOL_BASE}/seller/orders/{order_id}/fulfillment",
        headers={**_mp_headers(api_key, email), "Content-Type": "application/json"},
        json=body,
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def consolidate_orders(orders: list[dict]) -> dict[tuple, dict]:
    """Combine all orders into one master list, tracking allocations per order."""
    master: dict[tuple, dict] = {}
    for order in orders:
        oid = order.get("id")
        for item in order.get("items", []) or []:
            product = item.get("product") or {}
            single = product.get("single") or {}
            if not single:
                continue
            name = (single.get("name") or "").strip()
            set_code = (single.get("set") or "").strip().lower()
            collector = str(single.get("number") or "").strip()
            finish = FINISH_LABELS.get(single.get("finish_id", ""), "nonfoil")
            scryfall_id = single.get("scryfall_id")
            qty = int(item.get("quantity") or 1)
            if not name:
                continue

            key = (name, set_code, collector, finish)
            if key not in master:
                master[key] = {
                    "name": name,
                    "set": set_code,
                    "collector_number": collector,
                    "finish": finish,
                    "quantity": 0,
                    "scryfall_id": scryfall_id,
                    "allocations": {},  # Tracks {order_id: qty_needed}
                }
            master[key]["quantity"] += qty
            master[key]["allocations"][oid] = (
                master[key]["allocations"].get(oid, 0) + qty
            )
    return master


# --------------------------------------------------------------------------- #
# Scryfall & Sorting                                                          #
# --------------------------------------------------------------------------- #
@st.cache_data(show_spinner=False)
def fetch_scryfall_sets() -> dict[str, str]:
    """Fetch sets to sort by release date (newest first)."""
    try:
        r = requests.get(f"{SCRYFALL_BASE}/sets", timeout=15)
        if r.status_code == 200:
            return {
                s["code"].lower(): s.get("released_at", "1990-01-01")
                for s in r.json().get("data", [])
            }
    except requests.RequestException:
        pass
    return {}


@st.cache_data(show_spinner=False)
def scryfall_lookup(
    name: str, set_code: str, collector: str, scryfall_id: str | None = None
) -> dict | None:
    time.sleep(0.1)
    try:
        if scryfall_id:
            r = requests.get(f"{SCRYFALL_BASE}/cards/{scryfall_id}", timeout=15)
            if r.status_code == 200:
                return r.json()
        if set_code and collector:
            r = requests.get(
                f"{SCRYFALL_BASE}/cards/{set_code}/{collector}", timeout=15
            )
            if r.status_code == 200:
                return r.json()
        params: dict[str, Any] = {"exact": name}
        if set_code:
            params["set"] = set_code
        r = requests.get(f"{SCRYFALL_BASE}/cards/named", params=params, timeout=15)
        if r.status_code == 200:
            return r.json()
    except requests.RequestException:
        return None
    return None


def card_image(card: dict | None) -> str | None:
    if not card:
        return None
    images = card.get("image_uris")
    if images:
        return images.get("normal") or images.get("large") or images.get("small")
    faces = card.get("card_faces") or []
    if faces and isinstance(faces, list):
        face_imgs = faces[0].get("image_uris") if isinstance(faces[0], dict) else None
        if face_imgs:
            return (
                face_imgs.get("normal")
                or face_imgs.get("large")
                or face_imgs.get("small")
            )
    return None


def color_sort_index(card: dict) -> int:
    """W=1, U=2, B=3, R=4, G=5, Multi=6, Colorless=7, Lands=8"""
    if not card:
        return 9
    type_line = card.get("type_line", "")
    colors = card.get("colors", [])

    if "Land" in type_line:
        return 8
    if not colors:
        return 7
    if len(colors) > 1:
        return 6

    color_map = {"W": 1, "U": 2, "B": 3, "R": 4, "G": 5}
    return color_map.get(colors[0], 9)


def parse_collector_number(cn: str) -> tuple[int, str]:
    """Parse collector number for numeric-aware sorting (e.g., '10a', 'F12')."""
    # Fixed regex: search anywhere in the string for digits
    match = re.search(r"(\d+)", str(cn))
    if match:
        return (int(match.group(1)), str(cn))
    return (0, str(cn))


# --------------------------------------------------------------------------- #
# UI                                                                          #
# --------------------------------------------------------------------------- #
st.title("🃏 ManaPick")
st.caption(
    "Pick & pack helper for Manapool sellers — sorted by Set, Color, and Collector Number."
)

# State initialization
if "master" not in st.session_state:
    st.session_state.master = {}
if "picked" not in st.session_state:
    st.session_state.picked = {}
if "orders" not in st.session_state:
    st.session_state.orders = []
if "order_to_bin" not in st.session_state:
    st.session_state.order_to_bin = {}
if "phase" not in st.session_state:
    st.session_state.phase = "pick"
if "shipped" not in st.session_state:
    st.session_state.shipped = {}

api_key = os.environ.get("MANAPOOL_API_KEY", "")
seller_email = os.environ.get("MANAPOOL_EMAIL", "")

# We add simple text inputs just in case the environment variables aren't set
with st.expander("⚙️ Settings", expanded=not (api_key and seller_email)):
    api_key = st.text_input("Manapool API Key", value=api_key, type="password")
    seller_email = st.text_input("Seller Email", value=seller_email)

col_fetch, col_cache, _ = st.columns([2, 1, 5])
with col_fetch:
    fetch_btn = st.button(
        "Fetch Paid / Unshipped Orders",
        type="primary",
        use_container_width=True,
        disabled=not (api_key and seller_email),
    )
with col_cache:
    if st.button("Clear cache", use_container_width=True):
        scryfall_lookup.clear()
        fetch_scryfall_sets.clear()
        st.success("Cache cleared.")

if st.session_state.orders:
    with st.expander("📦 Active Bins Reference", expanded=False):
        for order in st.session_state.orders:
            oid = order.get("id")
            bin_num = st.session_state.order_to_bin.get(oid, "?")
            label = order.get("label") or oid[:8]
            st.markdown(f"**Bin {bin_num}** — `{label}`")

if fetch_btn:
    with st.spinner("Fetching orders from Manapool…"):
        try:
            orders = fetch_manapool_orders(api_key, seller_email or None)
        except Exception as e:
            st.error(f"Failed to fetch orders: {e}")
            orders = []

    st.session_state.orders = orders
    st.session_state.master = consolidate_orders(orders)
    st.session_state.picked = {}
    st.session_state.shipped = {}
    st.session_state.phase = "pick"

    # Assign persistent Bin Numbers to new orders
    for order in orders:
        oid = order.get("id")
        if oid and oid not in st.session_state.order_to_bin:
            next_bin = len(st.session_state.order_to_bin) + 1
            st.session_state.order_to_bin[oid] = next_bin

    st.success(
        f"Loaded {len(orders)} orders → {len(st.session_state.master)} unique cards."
    )

    # Enrich
    progress = st.progress(0.0, text="Enriching cards from Scryfall…")
    items = list(st.session_state.master.items())
    for i, (key, entry) in enumerate(items):
        entry["scryfall"] = scryfall_lookup(
            entry["name"],
            entry["set"],
            entry["collector_number"],
            entry.get("scryfall_id"),
        )
        progress.progress(
            (i + 1) / max(1, len(items)), text=f"Enriching {i + 1}/{len(items)}…"
        )
    progress.empty()

master = st.session_state.master
if not master:
    st.info("Click **Fetch Paid / Unshipped Orders** to begin.")
    st.stop()

# Metrics Calculations
total_cards = sum(e["quantity"] for e in master.values())
picked_total = 0
for key, entry in master.items():
    state_key = "|".join(str(x) for x in key)
    for oid, qty in entry["allocations"].items():
        if st.session_state.picked.get(f"{state_key}|{oid}"):
            picked_total += qty

c1, c2, c3, c4 = st.columns(4)
c1.metric("Unique cards", len(master))
c2.metric("Total to pick", total_cards)
c3.metric("Picked", picked_total)
c4.metric("Orders", len(st.session_state.orders))
st.progress(picked_total / max(1, total_cards))

phase = st.session_state.phase
nav1, nav2 = st.columns(2)
if nav1.button(
    "🃏 Pick mode",
    type="primary" if phase == "pick" else "secondary",
    use_container_width=True,
):
    st.session_state.phase = "pick"
    st.rerun()
if nav2.button(
    "📦 Pack & Ship mode",
    type="primary" if phase == "pack" else "secondary",
    use_container_width=True,
):
    st.session_state.phase = "pack"
    st.rerun()
st.divider()


def _toggle_pick(pick_key: str) -> None:
    st.session_state.picked[pick_key] = not st.session_state.picked.get(pick_key, False)


def render_card(key: tuple, entry: dict) -> None:
    card = entry.get("scryfall") or {}
    img = card_image(card)
    state_key = "|".join(str(x) for x in key)

    # Check if all bins for this card are picked
    all_picked = all(
        st.session_state.picked.get(f"{state_key}|{oid}", False)
        for oid in entry["allocations"]
    )

    opacity = 0.35 if all_picked else 1.0
    is_foil = entry["finish"] in ("foil", "etched")

    foil_style = (
        "padding:4px;border-radius:14px;"
        "background:linear-gradient(135deg,#ffd34d,#ff6ec7,#7afcff,#a6ff7a,#ffd34d);"
        "background-size:300% 300%;"
        if is_foil
        else "padding:0;"
    )

    if img:
        st.markdown(
            f"""
            <div style="opacity:{opacity};transition:opacity .2s;{foil_style}">
              <img src="{img}" style="width:100%;border-radius:10px;display:block;" />
            </div>
            """,
            unsafe_allow_html=True,
        )
    else:
        st.markdown(f"**{entry['name']}**")

    label = entry["name"]
    finish_tag = (
        " ✨FOIL"
        if entry["finish"] == "foil"
        else (" ✨ETCHED" if entry["finish"] == "etched" else "")
    )
    set_info = f"{entry['set'].upper()} · #{entry['collector_number']}{finish_tag}"
    name_html = f"<s>{label}</s>" if all_picked else f"<b>{label}</b>"

    st.markdown(
        f"""
        <div style='line-height:1.25;margin-top:6px; margin-bottom:8px;
                    opacity:{0.55 if all_picked else 1}'>
          {name_html}<br>
          <span style='color:#888;font-size:.85em'>{set_info}</span>
        </div>
        """,
        unsafe_allow_html=True,
    )

    # Render Bin Tags (Buttons)
    for oid, qty in entry["allocations"].items():
        bin_num = st.session_state.order_to_bin.get(oid, "?")
        pick_key = f"{state_key}|{oid}"
        is_picked = st.session_state.picked.get(pick_key, False)

        btn_label = (
            f"✅ Bin {bin_num} (x{qty})" if is_picked else f"🔲 Bin {bin_num} (x{qty})"
        )
        btn_type = "secondary" if is_picked else "primary"

        st.button(
            btn_label,
            key=f"btn_{pick_key}",
            on_click=_toggle_pick,
            args=(pick_key,),
            use_container_width=True,
            type=btn_type,
        )


def render_pack_view() -> None:
    orders = st.session_state.orders or []
    if not orders:
        st.info("No orders to pack.")
        return

    def _card_count(o: dict) -> int:
        return sum(
            int(it.get("quantity") or 0)
            for it in (o.get("items") or [])
            if ((it.get("product") or {}).get("single"))
        )

    pending = [o for o in orders if not st.session_state.shipped.get(o.get("id"))]
    done = [o for o in orders if st.session_state.shipped.get(o.get("id"))]
    pending_cards = sum(_card_count(o) for o in pending)
    done_cards = sum(_card_count(o) for o in done)
    st.markdown(
        f"**{len(pending)} orders to pack** ({pending_cards} cards) · "
        f"{len(done)} shipped ({done_cards} cards)"
    )

    for order in pending:
        oid = order.get("id", "")
        bin_num = st.session_state.order_to_bin.get(oid, "?")
        addr = order.get("shipping_address") or {}
        label = order.get("label") or oid[:8]
        items = order.get("items") or []

        with st.container(border=True):
            top_l, top_r = st.columns([2, 1])
            with top_l:
                n_cards = _card_count(order)
                st.markdown(f"### 📦 Bin {bin_num} — Order `{label}`")
                st.markdown(f"**{n_cards} card{'s' if n_cards != 1 else ''}**")
                lines = [
                    addr.get("name", ""),
                    addr.get("line1", ""),
                    addr.get("line2") or "",
                    addr.get("line3") or "",
                    f"{addr.get('city', '')}, {addr.get('state', '')} "
                    f"{addr.get('postal_code', '')}",
                    addr.get("country", ""),
                ]
                st.code("\n".join(l for l in lines if l), language=None)
                ship_method = order.get("shipping_method", "")
                st.caption(
                    f"Required shipping: {ship_method.replace('_', ' ').title()}"
                )
            with top_r:
                tracking = st.text_input(
                    "USPS tracking #", key=f"trk-{oid}", placeholder="Optional"
                )
                if st.button(
                    "✓ Mark shipped via USPS",
                    key=f"ship-{oid}",
                    type="primary",
                    use_container_width=True,
                ):
                    try:
                        mark_order_shipped(api_key, seller_email, oid, tracking)
                        st.session_state.shipped[oid] = True
                        st.success("Shipped!")
                        st.rerun()
                    except Exception as e:
                        st.error(f"Failed to update Manapool: {e}")

            cols = st.columns(6)
            i = 0
            for item in items:
                single = (item.get("product") or {}).get("single") or {}
                if not single:
                    continue
                key = (
                    single.get("name", ""),
                    (single.get("set") or "").lower(),
                    str(single.get("number") or ""),
                    FINISH_LABELS.get(single.get("finish_id", ""), "nonfoil"),
                )
                entry = master.get(key, {})
                img = card_image(entry.get("scryfall") or {})
                qty = int(item.get("quantity") or 1)
                with cols[i % 6]:
                    if img:
                        st.markdown(
                            f"<img src='{img}' style='width:100%;border-radius:8px;'/>"
                            f"<div style='text-align:center;font-weight:700'>×{qty}</div>"
                            f"<div style='text-align:center;font-size:.8em;color:#888'>"
                            f"{single.get('name', '')}</div>",
                            unsafe_allow_html=True,
                        )
                    else:
                        st.markdown(f"**{single.get('name', '')}** ×{qty}")
                i += 1

    if done:
        with st.expander(f"✅ Shipped ({len(done)})"):
            for o in done:
                oid = o.get("id", "")
                bin_num = st.session_state.order_to_bin.get(oid, "?")
                st.markdown(
                    f"- **Bin {bin_num}** (`{o.get('label') or oid[:8]}`) — "
                    f"{(o.get('shipping_address') or {}).get('name', '')}"
                )


if phase == "pack":
    render_pack_view()
    st.stop()

# --------------------------------------------------------------------------- #
# Main Pick View Rendering                                                    #
# --------------------------------------------------------------------------- #
# Group by Set
sets_dict = defaultdict(list)
for key, entry in master.items():
    sets_dict[entry["set"]].append((key, entry))

scryfall_sets_map = fetch_scryfall_sets()

# Sort Sets by Release Date (Newest First)
sorted_set_codes = sorted(
    sets_dict.keys(), key=lambda s: scryfall_sets_map.get(s, "1900-01-01"), reverse=True
)

for set_code in sorted_set_codes:
    st.header(f"Set: {set_code.upper()}")

    # Sort cards within the set by Color -> Collector Number
    cards = sets_dict[set_code]
    cards_sorted = sorted(
        cards,
        key=lambda c: (
            color_sort_index(c[1].get("scryfall")),
            parse_collector_number(c[1]["collector_number"]),
        ),
    )

    cols = st.columns(4)
    for i, (key, entry) in enumerate(cards_sorted):
        with cols[i % 4]:
            render_card(key, entry)

    st.divider()
