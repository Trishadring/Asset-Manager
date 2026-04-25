"""ManaPick — MTG order picking helper for Manapool sellers."""
from __future__ import annotations

import os
import time
from collections import defaultdict
from typing import Any

import requests
import streamlit as st

st.set_page_config(page_title="ManaPick", page_icon="🃏", layout="wide")

MANAPOOL_BASE = "https://manapool.com/api/v1"
SCRYFALL_BASE = "https://api.scryfall.com"

COLOR_ORDER = ["W", "U", "B", "R", "G"]
COLOR_NAMES = {
    "W": "White",
    "U": "Blue",
    "B": "Black",
    "R": "Red",
    "G": "Green",
}
TYPE_ORDER = ["Legendary", "Creature", "Planeswalker", "Instant", "Sorcery", "Enchantment", "Other"]
TYPE_MATCH_PRIORITY = ["Legendary", "Enchantment", "Planeswalker", "Creature", "Instant", "Sorcery"]
BASIC_LAND_NAMES = {"Plains", "Island", "Swamp", "Mountain", "Forest",
                    "Snow-Covered Plains", "Snow-Covered Island", "Snow-Covered Swamp",
                    "Snow-Covered Mountain", "Snow-Covered Forest", "Wastes"}


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
        raise RuntimeError("Manapool requires your seller email along with the API token.")
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

    # Fetch full order details (which include items) for each summary
    detailed: list[dict] = []
    for s in summaries:
        oid = s.get("id")
        if not oid:
            continue
        r = requests.get(f"{MANAPOOL_BASE}/seller/orders/{oid}",
                         headers=headers, timeout=30)
        if r.status_code == 200:
            payload = r.json() or {}
            detailed.append(payload.get("order", payload))
        time.sleep(0.05)
    return detailed


def mark_order_shipped(api_key: str, email: str, order_id: str,
                       tracking_number: str = "") -> dict:
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
        json=body, timeout=30,
    )
    r.raise_for_status()
    return r.json()


def consolidate_orders(orders: list[dict]) -> dict[tuple, dict]:
    """Combine all orders into one master list, summing quantities for identical cards.
    Identity = (Name, Set, Collector Number, Finish)."""
    master: dict[tuple, dict] = {}
    for order in orders:
        for item in order.get("items", []) or []:
            product = item.get("product") or {}
            single = product.get("single") or {}
            if not single:
                continue  # skip sealed
            name = (single.get("name") or "").strip()
            set_code = (single.get("set") or "").strip().lower()
            collector = str(single.get("number") or "").strip()
            finish = FINISH_LABELS.get(single.get("finish_id", ""), "nonfoil")
            scryfall_id = single.get("scryfall_id")
            qty = int(item.get("quantity") or 1)
            if not name:
                continue
            key = (name, set_code, collector, finish)
            if key in master:
                master[key]["quantity"] += qty
            else:
                master[key] = {
                    "name": name,
                    "set": set_code,
                    "collector_number": collector,
                    "finish": finish,
                    "quantity": qty,
                    "scryfall_id": scryfall_id,
                }
    return master


# --------------------------------------------------------------------------- #
# Scryfall                                                                    #
# --------------------------------------------------------------------------- #
@st.cache_data(show_spinner=False)
def scryfall_lookup(name: str, set_code: str, collector: str,
                    scryfall_id: str | None = None) -> dict | None:
    """Lookup a card on Scryfall, with caching. Rate limited to ~10/sec."""
    time.sleep(0.1)  # Scryfall asks for 50-100ms between requests
    try:
        if scryfall_id:
            r = requests.get(f"{SCRYFALL_BASE}/cards/{scryfall_id}", timeout=15)
            if r.status_code == 200:
                return r.json()
        if set_code and collector:
            r = requests.get(f"{SCRYFALL_BASE}/cards/{set_code}/{collector}",
                             timeout=15)
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
            return face_imgs.get("normal") or face_imgs.get("large") or face_imgs.get("small")
    return None


# --------------------------------------------------------------------------- #
# Sorting                                                                     #
# --------------------------------------------------------------------------- #
def clean_type_line(type_line: str) -> str:
    return " ".join(t for t in type_line.replace("—", "-").split()
                    if t.lower() not in {"kindred", "tribal"})


def primary_type(type_line: str) -> str:
    tl = clean_type_line(type_line)
    for t in TYPE_MATCH_PRIORITY:
        if t in tl:
            return t
    return "Other"


def color_bucket(colors: list[str]) -> str:
    """Return color section name for a (non-land, non-artifact) spell."""
    if not colors:
        return "Colorless"
    if len(colors) == 1:
        return COLOR_NAMES[colors[0]]
    return "Multicolor"


def classify_card(entry: dict) -> tuple[str, str, str]:
    """Return (section, subsection, sub_sort_key)."""
    card = entry.get("scryfall") or {}
    type_line = clean_type_line(card.get("type_line") or "")
    colors = card.get("colors") or []
    color_identity = card.get("color_identity") or []
    oracle = (card.get("oracle_text") or "").lower()

    is_land = "Land" in type_line
    is_artifact = "Artifact" in type_line
    is_creature = "Creature" in type_line

    # Lands
    if is_land:
        name = entry["name"]
        if name in BASIC_LAND_NAMES or "Basic" in type_line:
            return ("Basic Lands", name, name)
        # Any-color: produces any color of mana
        if "any color" in oracle or "mana of any color" in oracle:
            return ("Non-Basic Lands", "Any-Color", entry["name"])
        if len(color_identity) >= 2:
            pair = "/".join(COLOR_NAMES[c] for c in COLOR_ORDER if c in color_identity)
            return ("Non-Basic Lands", f"Dual/Fixing — {pair}", entry["name"])
        return ("Non-Basic Lands", "Utility Lands", entry["name"])

    # Artifacts (colorless)
    if is_artifact and not colors:
        if "Equipment" in type_line or "Vehicle" in type_line:
            return ("Artifacts (Colorless)", "Equipment / Vehicles", entry["name"])
        if is_creature:
            return ("Artifacts (Colorless)", "Artifact Creatures", entry["name"])
        if "add" in oracle and "mana" in oracle:
            return ("Artifacts (Colorless)", "Mana Rocks", entry["name"])
        return ("Artifacts (Colorless)", "Utility Artifacts", entry["name"])

    # Spells by color
    bucket = color_bucket(colors)
    ptype = primary_type(type_line)
    return ("Spells", bucket, f"{TYPE_ORDER.index(ptype):02d}-{ptype}-{entry['name']}")


def color_sort_index(label: str) -> int:
    order = ["White", "Blue", "Black", "Red", "Green", "Multicolor", "Colorless"]
    return order.index(label) if label in order else 99


# --------------------------------------------------------------------------- #
# UI                                                                          #
# --------------------------------------------------------------------------- #
st.title("🃏 ManaPick")
st.caption("Pick & pack helper for Manapool sellers — sorted the way your physical box is.")

with st.sidebar:
    st.header("Settings")
    api_key = st.text_input("MANAPOOL_API_KEY", type="password",
                            help="Your Manapool seller API key.")
    seller_email = st.text_input("Seller email",
                                 help="The email on your Manapool account.")
    fetch_btn = st.button("Fetch Paid / Unshipped Orders", type="primary",
                          use_container_width=True,
                          disabled=not (api_key and seller_email))
    st.divider()
    if st.button("Clear card cache", use_container_width=True):
        scryfall_lookup.clear()
        st.success("Cache cleared.")

# State
if "master" not in st.session_state:
    st.session_state.master = {}
if "picked" not in st.session_state:
    st.session_state.picked = {}
if "orders" not in st.session_state:
    st.session_state.orders = []
if "phase" not in st.session_state:
    st.session_state.phase = "pick"
if "shipped" not in st.session_state:
    st.session_state.shipped = {}

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
    st.success(f"Loaded {len(orders)} orders → {len(st.session_state.master)} unique cards.")

    # Enrich
    progress = st.progress(0.0, text="Enriching cards from Scryfall…")
    items = list(st.session_state.master.items())
    for i, (key, entry) in enumerate(items):
        entry["scryfall"] = scryfall_lookup(entry["name"], entry["set"],
                                            entry["collector_number"],
                                            entry.get("scryfall_id"))
        progress.progress((i + 1) / max(1, len(items)),
                          text=f"Enriching {i + 1}/{len(items)}…")
    progress.empty()

master = st.session_state.master
if not master:
    st.info("Enter your API key in the sidebar and fetch orders to begin.")
    st.stop()

# Bucket everything
buckets: dict[str, dict[str, list[tuple[tuple, dict, str]]]] = defaultdict(lambda: defaultdict(list))
for key, entry in master.items():
    section, subsection, sort_key = classify_card(entry)
    buckets[section][subsection].append((key, entry, sort_key))

SECTION_ORDER = ["Spells", "Artifacts (Colorless)", "Non-Basic Lands", "Basic Lands"]
SPELL_SUB_ORDER = ["White", "Blue", "Black", "Red", "Green", "Multicolor", "Colorless"]
ARTIFACT_SUB_ORDER = ["Mana Rocks", "Equipment / Vehicles", "Artifact Creatures", "Utility Artifacts"]

total_cards = sum(e["quantity"] for e in master.values())
_state_to_key = {"|".join(str(x) for x in k): k for k in master}
picked_total = sum(
    master[_state_to_key[sk]]["quantity"]
    for sk, v in st.session_state.picked.items()
    if v and sk in _state_to_key
)

c1, c2, c3, c4 = st.columns(4)
c1.metric("Unique cards", len(master))
c2.metric("Total to pick", total_cards)
c3.metric("Picked", picked_total)
c4.metric("Orders", len(st.session_state.orders))
st.progress(picked_total / max(1, total_cards))

phase = st.session_state.phase
nav1, nav2 = st.columns(2)
if nav1.button("🃏 Pick mode",
               type="primary" if phase == "pick" else "secondary",
               use_container_width=True):
    st.session_state.phase = "pick"
    st.rerun()
if nav2.button("📦 Pack & Ship mode",
               type="primary" if phase == "pack" else "secondary",
               use_container_width=True):
    st.session_state.phase = "pack"
    st.rerun()
st.divider()


def _toggle_pick(sk: str) -> None:
    st.session_state.picked[sk] = not st.session_state.picked.get(sk, False)


def _set_picks(state_keys: list[str], value: bool) -> None:
    for sk in state_keys:
        st.session_state.picked[sk] = value


def render_card(key: tuple, entry: dict) -> None:
    card = entry.get("scryfall") or {}
    img = card_image(card)
    qty = entry["quantity"]
    state_key = "|".join(str(x) for x in key)
    is_picked = st.session_state.picked.get(state_key, False)
    opacity = 0.35 if is_picked else 1.0
    is_foil = entry["finish"] in ("foil", "etched")

    foil_style = (
        "padding:4px;border-radius:14px;"
        "background:linear-gradient(135deg,#ffd34d,#ff6ec7,#7afcff,#a6ff7a,#ffd34d);"
        "background-size:300% 300%;"
        if is_foil else "padding:0;"
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
    finish_tag = " ✨FOIL" if entry["finish"] == "foil" else (
        " ✨ETCHED" if entry["finish"] == "etched" else "")
    set_info = f"{entry['set'].upper()} · #{entry['collector_number']}{finish_tag}"
    name_html = f"<s>{label}</s>" if is_picked else f"<b>{label}</b>"
    info_html = f"<s>{set_info}</s>" if is_picked else set_info
    pick_color = "#666" if is_picked else "#0a7d2c"
    st.markdown(
        f"""
        <div style='line-height:1.25;margin-top:6px;
                    opacity:{0.55 if is_picked else 1}'>
          {name_html}<br>
          <span style='color:{pick_color};font-weight:700'>PICK: {qty}</span>
          <span style='color:#888;font-size:.85em'> · {info_html}</span>
        </div>
        """,
        unsafe_allow_html=True,
    )
    btn_label = "✓ Picked (click to undo)" if is_picked else "Mark Picked"
    st.button(btn_label, key=f"pick-{state_key}",
              use_container_width=True,
              on_click=_toggle_pick, args=(state_key,))


def _grid_state_keys(cards: list[tuple[tuple, dict, str]]) -> list[str]:
    return ["|".join(str(x) for x in c[0]) for c in cards]


def render_grid(cards: list[tuple[tuple, dict, str]],
                bulk_id: str | None = None) -> None:
    cards = sorted(cards, key=lambda c: c[2])
    if bulk_id:
        sks = _grid_state_keys(cards)
        all_picked = sks and all(st.session_state.picked.get(s) for s in sks)
        b1, b2 = st.columns([1, 1])
        b1.button("✓ Mark all picked", key=f"all-{bulk_id}",
                  use_container_width=True, disabled=bool(all_picked),
                  on_click=_set_picks, args=(sks, True))
        b2.button("Reset section", key=f"reset-{bulk_id}",
                  use_container_width=True,
                  on_click=_set_picks, args=(sks, False))
    cols = st.columns(4)
    for i, (key, entry, _) in enumerate(cards):
        with cols[i % 4]:
            render_card(key, entry)


def render_pack_view() -> None:
    orders = st.session_state.orders or []
    if not orders:
        st.info("No orders to pack.")
        return

    def _card_count(o: dict) -> int:
        return sum(int(it.get("quantity") or 0) for it in (o.get("items") or [])
                   if ((it.get("product") or {}).get("single")))

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
        addr = order.get("shipping_address") or {}
        label = order.get("label") or oid[:8]
        items = order.get("items") or []

        with st.container(border=True):
            top_l, top_r = st.columns([2, 1])
            with top_l:
                n_cards = _card_count(order)
                st.markdown(f"### Order `{label}` — {n_cards} card{'s' if n_cards != 1 else ''}")
                lines = [
                    addr.get("name", ""),
                    addr.get("line1", ""),
                    addr.get("line2") or "",
                    addr.get("line3") or "",
                    f"{addr.get('city','')}, {addr.get('state','')} "
                    f"{addr.get('postal_code','')}",
                    addr.get("country", ""),
                ]
                st.code("\n".join(l for l in lines if l), language=None)
                ship_method = order.get("shipping_method", "")
                st.caption(f"Required shipping: {ship_method.replace('_', ' ').title()}")
            with top_r:
                tracking = st.text_input("USPS tracking #",
                                         key=f"trk-{oid}",
                                         placeholder="Optional")
                if st.button("✓ Mark shipped via USPS",
                             key=f"ship-{oid}",
                             type="primary",
                             use_container_width=True):
                    try:
                        mark_order_shipped(api_key, seller_email, oid, tracking)
                        st.session_state.shipped[oid] = True
                        st.success("Shipped!")
                        st.rerun()
                    except Exception as e:
                        st.error(f"Failed to update Manapool: {e}")

            # Card images for this order
            cols = st.columns(6)
            i = 0
            for item in items:
                single = ((item.get("product") or {}).get("single") or {})
                if not single:
                    continue
                key = (single.get("name", ""), (single.get("set") or "").lower(),
                       str(single.get("number") or ""),
                       FINISH_LABELS.get(single.get("finish_id", ""), "nonfoil"))
                entry = master.get(key, {})
                img = card_image(entry.get("scryfall") or {})
                qty = int(item.get("quantity") or 1)
                with cols[i % 6]:
                    if img:
                        st.markdown(
                            f"<img src='{img}' style='width:100%;border-radius:8px;'/>"
                            f"<div style='text-align:center;font-weight:700'>×{qty}</div>"
                            f"<div style='text-align:center;font-size:.8em;color:#888'>"
                            f"{single.get('name','')}</div>",
                            unsafe_allow_html=True)
                    else:
                        st.markdown(f"**{single.get('name','')}** ×{qty}")
                i += 1

    if done:
        with st.expander(f"✅ Shipped ({len(done)})"):
            for o in done:
                st.markdown(f"- `{o.get('label') or o.get('id','')[:8]}` — "
                            f"{(o.get('shipping_address') or {}).get('name','')}")


if phase == "pack":
    render_pack_view()
    st.stop()


# Render sections
for section in SECTION_ORDER:
    if section not in buckets:
        continue
    st.header(section)
    subs = buckets[section]

    if section == "Spells":
        ordered = [s for s in SPELL_SUB_ORDER if s in subs]
    elif section == "Artifacts (Colorless)":
        ordered = [s for s in ARTIFACT_SUB_ORDER if s in subs]
    elif section == "Non-Basic Lands":
        fixed = [s for s in ["Any-Color"] if s in subs]
        duals = sorted(s for s in subs if s.startswith("Dual/Fixing"))
        utility = [s for s in ["Utility Lands"] if s in subs]
        ordered = fixed + duals + utility
    else:
        ordered = sorted(subs.keys())

    for sub in ordered:
        st.subheader(sub)
        if section == "Spells":
            by_type: dict[str, list] = defaultdict(list)
            for item in subs[sub]:
                parts = item[2].split("-", 2)
                ptype = parts[1] if len(parts) >= 2 else "Other"
                by_type[ptype].append(item)
            for ptype in TYPE_ORDER:
                if ptype in by_type:
                    st.markdown(f"**{ptype}s**")
                    render_grid(by_type[ptype],
                                bulk_id=f"{section}-{sub}-{ptype}")
        else:
            render_grid(subs[sub], bulk_id=f"{section}-{sub}")
