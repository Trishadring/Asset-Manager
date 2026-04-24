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
TYPE_ORDER = ["Creature", "Planeswalker", "Instant", "Sorcery", "Enchantment", "Other"]
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
            detailed.append(r.json())
        time.sleep(0.05)
    return detailed


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
    for t in ["Creature", "Planeswalker", "Instant", "Sorcery", "Enchantment"]:
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
                            value=os.environ.get("MANAPOOL_API_KEY", ""),
                            help="Your Manapool seller API key.")
    seller_email = st.text_input("Seller email",
                                 value=os.environ.get("MANAPOOL_EMAIL", ""),
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

if fetch_btn:
    with st.spinner("Fetching orders from Manapool…"):
        try:
            orders = fetch_manapool_orders(api_key, seller_email or None)
        except Exception as e:
            st.error(f"Failed to fetch orders: {e}")
            orders = []
    st.session_state.master = consolidate_orders(orders)
    st.session_state.picked = {}
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
picked_total = sum(master[k]["quantity"] for k in st.session_state.picked
                   if st.session_state.picked.get(k) and k in master)

c1, c2, c3 = st.columns(3)
c1.metric("Unique cards", len(master))
c2.metric("Total to pick", total_cards)
c3.metric("Picked", picked_total)
st.progress(picked_total / max(1, total_cards))


def render_card(key: tuple, entry: dict) -> None:
    card = entry.get("scryfall") or {}
    img = card_image(card)
    qty = entry["quantity"]
    state_key = "|".join(str(x) for x in key)
    is_picked = st.session_state.picked.get(state_key, False)
    opacity = 0.3 if is_picked else 1.0

    if img:
        st.markdown(
            f"""
            <div style="position:relative;opacity:{opacity};transition:opacity .2s;">
              <img src="{img}" style="width:100%;border-radius:12px;display:block;" />
              <div style="position:absolute;top:8px;left:8px;
                          background:#111;color:#fff;font-weight:800;
                          padding:6px 12px;border-radius:8px;font-size:18px;
                          border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);">
                PICK: {qty}
              </div>
            </div>
            """,
            unsafe_allow_html=True,
        )
    else:
        st.markdown(f"**{entry['name']}** — PICK: {qty}")

    label = entry["name"]
    set_info = f"{entry['set'].upper()} · #{entry['collector_number']} · {entry['finish']}"
    if is_picked:
        st.markdown(
            f"<div style='opacity:.45'><s>{label}</s><br><small><s>{set_info}</s></small></div>",
            unsafe_allow_html=True,
        )
    else:
        st.markdown(f"{label}<br><small style='color:#888'>{set_info}</small>",
                    unsafe_allow_html=True)
    st.checkbox("Picked", key=f"pick-{state_key}",
                value=is_picked,
                on_change=lambda sk=state_key: st.session_state.picked.update(
                    {sk: not st.session_state.picked.get(sk, False)}))


def render_grid(cards: list[tuple[tuple, dict, str]]) -> None:
    cards = sorted(cards, key=lambda c: c[2])
    cols = st.columns(4)
    for i, (key, entry, _) in enumerate(cards):
        with cols[i % 4]:
            render_card(key, entry)


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
        st.subheader(f"{section} — {sub}")
        render_grid(subs[sub])
