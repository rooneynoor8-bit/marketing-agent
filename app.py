"""Web UI for the marketing agent.

Run:  streamlit run app.py
"""

import json

import anthropic
import streamlit as st

from agent import run_turn
from tools import CLIENTS_DIR, DATA_DIR, REPORTS_DIR, _slug

st.set_page_config(page_title="وكيل التسويق", page_icon="📈", layout="wide")
st.markdown(
    """<style>
    .stApp, .stMarkdown, .stChatMessage, textarea, input { direction: rtl; text-align: right; }
    code, pre { direction: ltr; text-align: left; }
    </style>""",
    unsafe_allow_html=True,
)


@st.cache_resource
def get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic()


def client_ids() -> list[str]:
    CLIENTS_DIR.mkdir(exist_ok=True)
    return sorted(p.stem for p in CLIENTS_DIR.glob("*.json"))


if "api_messages" not in st.session_state:
    st.session_state.api_messages = []  # full history sent to Claude
    st.session_state.chat = []          # (role, text) pairs shown on screen

# ---- Sidebar -------------------------------------------------------------
with st.sidebar:
    st.title("📈 وكيل التسويق")
    current = st.selectbox("العميل", ["— بدون عميل —", *client_ids()])
    current = None if current.startswith("—") else current
    if st.button("🆕 محادثة جديدة", use_container_width=True):
        st.session_state.api_messages = []
        st.session_state.chat = []
        st.rerun()
    st.caption("أمثلة: «حلل المنافسين»، «اكتب 10 بوستات للأسبوع الجاي»، «تقرير أداء آخر 7 أيام من Meta»")

chat_tab, reports_tab, data_tab, clients_tab = st.tabs(["💬 المحادثة", "📄 التقارير", "📊 بيانات الحملات", "👥 العملاء"])

# ---- Chat ----------------------------------------------------------------
with chat_tab:
    for role, text in st.session_state.chat:
        with st.chat_message(role):
            st.markdown(text)

    if prompt := st.chat_input("اكتب طلبك..."):
        st.session_state.chat.append(("user", prompt))
        with st.chat_message("user"):
            st.markdown(prompt)

        content = f"(العميل الحالي: {current})\n{prompt}" if current else prompt
        messages = st.session_state.api_messages
        turn_start = len(messages)
        messages.append({"role": "user", "content": content})

        with st.chat_message("assistant"):
            with st.status("بشتغل...", expanded=False) as status:
                try:
                    answer = run_turn(get_client(), messages, on_progress=st.write)
                    status.update(label="خلصت ✅", state="complete")
                except anthropic.APIError as e:
                    del messages[turn_start:]
                    answer = f"❌ حصل خطأ: {e}"
                    status.update(label="حصل خطأ", state="error")
            st.markdown(answer)
        st.session_state.chat.append(("assistant", answer))

# ---- Reports -------------------------------------------------------------
with reports_tab:
    REPORTS_DIR.mkdir(exist_ok=True)
    folders = sorted(p.name for p in REPORTS_DIR.iterdir() if p.is_dir())
    if not folders:
        st.info("لسه مفيش تقارير محفوظة.")
    else:
        default = folders.index(current) if current in folders else 0
        folder = st.selectbox("فولدر العميل", folders, index=default)
        files = sorted((REPORTS_DIR / folder).glob("*.md"), reverse=True)
        if files:
            chosen = st.selectbox("التقرير", files, format_func=lambda p: p.stem)
            text = chosen.read_text(encoding="utf-8")
            st.download_button("⬇️ تحميل", text, file_name=chosen.name, mime="text/markdown")
            st.markdown(text)

# ---- Campaign data -------------------------------------------------------
with data_tab:
    st.write("ارفع ملفات CSV من مدير الإعلانات. يُفضّل يبدأ اسم الملف باسم العميل (مثلاً `example-cafe_meta_oct.csv`) عشان التقرير الأسبوعي يلاقيه.")
    uploads = st.file_uploader("ملفات CSV", type="csv", accept_multiple_files=True)
    if uploads:
        DATA_DIR.mkdir(exist_ok=True)
        for f in uploads:
            name = f.name if not current or f.name.startswith(current) else f"{current}_{f.name}"
            (DATA_DIR / name).write_bytes(f.getvalue())
            st.success(f"اتحفظ: {name}")
    existing = sorted(p.name for p in DATA_DIR.glob("*.csv")) if DATA_DIR.exists() else []
    if existing:
        st.write("الملفات الموجودة:")
        st.write(existing)

# ---- Clients -------------------------------------------------------------
with clients_tab:
    st.write("عدّل ملف العميل مباشرة (JSON). لربط الإعلانات ضيف `meta_ad_account_id` و `google_ads_customer_id`.")
    options = ["➕ عميل جديد", *client_ids()]
    default = options.index(current) if current in options else 0
    target = st.selectbox("العميل", options, index=default, key="edit_client")
    if target.startswith("➕"):
        name = st.text_input("اسم العميل")
        initial = {
            "name": "", "website": "", "industry": "", "market": "", "products": [],
            "target_audience": "", "competitors": [], "brand_voice": "", "goals": "",
            "monthly_budget": "", "meta_ad_account_id": "", "google_ads_customer_id": "",
        }
    else:
        name = target
        initial = json.loads((CLIENTS_DIR / f"{target}.json").read_text(encoding="utf-8"))
    raw = st.text_area("البيانات", json.dumps(initial, ensure_ascii=False, indent=2), height=400)
    if st.button("💾 حفظ"):
        try:
            data = json.loads(raw)
            if not name:
                raise ValueError("اكتب اسم العميل")
            data["name"] = data.get("name") or name
            path = CLIENTS_DIR / f"{_slug(name)}.json"
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            st.success(f"اتحفظ: {path.name}")
        except (json.JSONDecodeError, ValueError) as e:
            st.error(f"خطأ: {e}")
